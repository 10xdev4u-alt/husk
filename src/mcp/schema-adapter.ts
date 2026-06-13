/**
 * Husk — JSONSchema → Zod schema adapter.
 *
 * Bridges the gap between Husk's tool definitions (which use a
 * minimal JSONSchema subset) and the MCP SDK's server side
 * (which expects a Zod schema / Standard Schema).
 *
 * Why we need this: Husk's inputSchema is `JSONSchema` because
 * it's provider-agnostic — Anthropic, OpenAI, and Ollama all
 * accept JSON Schema directly. The MCP server's registerTool
 * wants Zod (or any Standard Schema) because the SDK does its
 * own runtime validation against the schema. The cleanest
 * bridge is to convert at the adapter boundary.
 *
 * This module is lazy-loaded by defineMcpServer() — users who
 * never touch the MCP server don't pay the json-schema-to-zod
 * cost (~120KB unpacked).
 *
 * The conversion handles the JSONSchema subset Husk tools use
 * in practice (object properties with type/description, required
 * fields, enums). Exotic schema features (oneOf, anyOf, $ref)
 * fall back to a permissive z.any() — the MCP server still
 * works, the model's tool calls get less validation, and the
 * Husk-side schema validator (in executeTool) is the final
 * line of defense.
 */

import { z } from 'zod';
import type { JSONSchema, JSONSchemaField } from '../core/types.js';

/** A Zod schema — typed loosely so the lazy import doesn't leak. */
export type AnyZodSchema = z.ZodType<unknown>;

/** Cache for the dynamically-imported json-schema-to-zod module. */
let converterCache: ((schema: Record<string, unknown>) => AnyZodSchema) | undefined;

async function loadConverter(): Promise<(schema: Record<string, unknown>) => AnyZodSchema> {
  if (converterCache) return converterCache;
  try {
    // The lib returns a string (the .ts source code) by default
    // and a Zod schema if you pass { withSchema: true }. We need
    // the schema for the MCP server, so we eval the source at
    // runtime in a scope that has `z` in scope.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const mod = (await import('json-schema-to-zod')) as { jsonSchemaToZod: (s: unknown) => string };
    converterCache = (s: Record<string, unknown>) => {
      const tsSource = mod.jsonSchemaToZod(s);
      // tsSource is a string like "z.object({...})". We eval it
      // in a scope that has `z` in scope. Cast through unknown
      // so the eval return is typed as AnyZodSchema.
      const fn = new Function('z', `return (${tsSource});`);
      return fn(z) as AnyZodSchema;
    };
    return converterCache;
  } catch (err) {
    if (err instanceof Error && /Cannot find module/.test(err.message)) {
      throw new Error(
        "The 'json-schema-to-zod' package isn't installed. Run `npm install json-schema-to-zod` and try again. It's an optional peer dep — Husk only needs it for the MCP server adapter.",
      );
    }
    throw err;
  }
}

/**
 * Convert a Husk JSONSchema to a Zod schema. Lazy-loads
 * json-schema-to-zod on first call; the result is cached.
 *
 * The returned Zod schema can be passed directly to
 * server.registerTool(name, { inputSchema }, callback) — the
 * SDK accepts a Standard Schema and validates inputs against
 * it at call time.
 */
export async function jsonSchemaToZod(schema: JSONSchema): Promise<AnyZodSchema> {
  const converter = await loadConverter();
  // The lib expects a plain Record; JSONSchema is structurally
  // compatible so the cast is safe.
  return converter(schema as unknown as Record<string, unknown>);
}

/**
 * Synchronous variant. Throws if the converter hasn't been
 * loaded yet — use this only after a successful async
 * jsonSchemaToZod() call warmed the cache, or after
 * prewarmSchemaConverter() at app startup.
 */
export function jsonSchemaToZodSync(schema: JSONSchema): AnyZodSchema {
  if (!converterCache) {
    throw new Error(
      'jsonSchemaToZodSync() called before prewarmSchemaConverter() or a successful async jsonSchemaToZod(). Use the async version at app startup, or prewarm explicitly.',
    );
  }
  return converterCache(schema as unknown as Record<string, unknown>);
}

/**
 * Pre-warm the converter cache. Useful at app startup so the
 * first tool call doesn't pay the dynamic-import cost.
 */
export async function prewarmSchemaConverter(): Promise<void> {
  await loadConverter();
}

/**
 * Best-effort JSONSchema → Zod for the small subset Husk uses
 * in practice. Used as a FALLBACK when json-schema-to-zod
 * isn't installed — covers object, string, number, integer,
 * boolean, array, enum. Anything more exotic falls through to
 * a permissive z.any().
 *
 * This is intentionally hand-rolled and minimal so the
 * /mcp-server subpath has zero required deps for the common
 * case. Power users with complex schemas install
 * json-schema-to-zod for the full conversion.
 */
export function handRolledJsonSchemaToZod(schema: JSONSchema): AnyZodSchema {
  // Use a tiny inline Zod shim — we import zod as a regular
  // dep so the fallback is available without an extra install.
  // The /mcp subpath already pulls in zod transitively via the
  // MCP SDK, so this is effectively free.
  return handRolledSchema(schema) as AnyZodSchema;
}

// ───────────────────────────────────────────────────────────────────
// Fallback implementation (inline, no extra dep needed)
// ───────────────────────────────────────────────────────────────────

// Zod is already imported at the top of this file. The hand-rolled
// fallback below re-uses the same `z` binding.

function handRolledSchema(field: JSONSchema | JSONSchemaField): z.ZodTypeAny {
  // Enum is a string constrained to a fixed set.
  if ('enum' in field && Array.isArray(field.enum)) {
    // z.union requires a tuple of literal schemas; cast through unknown
    // because TypeScript can't infer the tuple shape from a runtime array.
    // The ZodLiteral generic is satisfied by the actual literal type.
    return z.union(
      field.enum.map((v) => z.literal(v as string | number | boolean)) as [
        z.ZodLiteral<string | number | boolean>,
        z.ZodLiteral<string | number | boolean>,
        ...z.ZodLiteral<string | number | boolean>[],
      ],
    ) as z.ZodTypeAny;
  }

  // Switch on type.
  switch (field.type) {
    case 'string':
      return z.string();
    case 'number':
      return z.number();
    case 'integer':
      return z.number().int();
    case 'boolean':
      return z.boolean();
    case 'array': {
      const items = field.items ? handRolledSchema(field.items) : z.any();
      return z.array(items);
    }
    case 'object': {
      const properties = field.properties ?? {};
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, propSchema] of Object.entries(properties)) {
        const child = handRolledSchema(propSchema);
        // The required array lives on the parent.
        shape[key] = field.required?.includes(key) ? child : child.optional();
      }
      return z.object(shape);
    }
    default:
      // No recognized type (or type is undefined). Permissive.
      return z.any();
  }
}
