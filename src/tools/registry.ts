/**
 * Husk — tool registry helpers.
 *
 * Tools in Husk are just objects that implement ToolDefinition. There's
 * no "register" call — you just pass an array to the Agent. These helpers
 * exist to make the common cases (naming, validation, common schemas)
 * less verbose.
 *
 * Why no global registry? Global state makes testing harder, breaks
 * tree-shaking, and prevents running multiple agents with different
 * tool sets in the same process. Explicit arrays are clearer.
 */

import type { JSONSchema, JSONSchemaField, ToolDefinition } from '../core/types.js';
import type { ValidationRuleSet } from './validation.js';

/**
 * Helper to build a tool definition with less boilerplate. The runtime
 * behavior is identical to a hand-written ToolDefinition object; this
 * just makes the common case (typed name, description, schema, executor)
 * read like a function call.
 */
export function defineTool<TInput>(tool: {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  execute: (input: TInput) => Promise<string> | string;
  /**
   * Optional validation rules. Pass a single rule or an array of
   * rules. See src/tools/validation.ts for the framework.
   */
  validate?: ValidationRuleSet;
  /**
   * If true, the tool's execute() is gated on user approval. The
   * agent loop surfaces the pending call to the caller and only
   * proceeds if approved.
   */
  requireApproval?: boolean;
}): ToolDefinition<TInput> {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.validate ? { validate: tool.validate } : {}),
    ...(tool.requireApproval ? { requireApproval: tool.requireApproval } : {}),
    execute: async (input) => {
      const result = await tool.execute(input);
      return typeof result === 'string' ? { output: result } : result;
    },
  };
}

// ───────────────────────────────────────────────────────────────────
// Schema builders — one helper per primitive type
// ───────────────────────────────────────────────────────────────────

/** String field with optional enum. */
export function stringField(
  description: string,
  options?: { enum?: readonly string[] },
): JSONSchemaField {
  return options?.enum
    ? { type: 'string', description, enum: options.enum }
    : { type: 'string', description };
}

/** Number field (integer or float). */
export function numberField(description: string): JSONSchemaField {
  return { type: 'number', description };
}

/** Integer field. */
export function integerField(description: string): JSONSchemaField {
  return { type: 'integer', description };
}

/** Boolean field. */
export function booleanField(description: string): JSONSchemaField {
  return { type: 'boolean', description };
}

/** Array field of a given element type. */
export function arrayField(description: string, items: JSONSchemaField): JSONSchemaField {
  return { type: 'array', description, items };
}

/** Object field with nested properties. */
export function objectField(
  description: string,
  properties: Readonly<Record<string, JSONSchemaField>>,
  required?: readonly string[],
): JSONSchemaField {
  return {
    type: 'object',
    description,
    properties,
    ...(required ? { required } : {}),
  };
}

/**
 * Build an object schema (the typical top-level shape for tool inputs).
 * Convenience wrapper around JSONSchema that defaults to type 'object'.
 */
export function objectSchema(
  properties: Readonly<Record<string, JSONSchemaField>>,
  required?: readonly string[],
): JSONSchema {
  return {
    type: 'object',
    properties,
    ...(required ? { required } : {}),
  };
}
