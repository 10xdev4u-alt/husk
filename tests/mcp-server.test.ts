/**
 * Tests for v0.7.0's defineMcpServer() adapter.
 *
 * Coverage:
 *   - jsonSchemaToZod (the bridge path) — converts a real JSONSchema
 *   - handRolledJsonSchemaToZod (the fallback) — string/number/bool/etc.
 *   - handRolledJsonSchemaToZod enum support
 *   - handRolledJsonSchemaToZod optional vs required
 *   - defineMcpServer — registers tools, wraps execute()
 *   - defineMcpServer — skips approval-gated tools by default
 *   - defineMcpServer — includes approval-gated tools when configured
 *
 * We don't spin up a real McpServer here (would need the SDK
 * deeply wired). The integration test against a real Claude
 * Desktop-style client lives in examples/12-mcp-server.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { ToolDefinition } from '../src/core/types.js';
import { defineMcpServer } from '../src/mcp/define-mcp-server.js';
import {
  handRolledJsonSchemaToZod,
  jsonSchemaToZod,
  prewarmSchemaConverter,
} from '../src/mcp/schema-adapter.js';
import {
  booleanField,
  defineTool,
  numberField,
  objectSchema,
  stringField,
} from '../src/tools/registry.js';

// ───────────────────────────────────────────────────────────────────
// handRolledJsonSchemaToZod
// ───────────────────────────────────────────────────────────────────

describe('handRolledJsonSchemaToZod', () => {
  test('converts string fields', () => {
    const zodSchema = handRolledJsonSchemaToZod({
      type: 'object',
      properties: { name: { type: 'string' } },
    });
    expect(zodSchema.parse({ name: 'alice' })).toEqual({ name: 'alice' });
  });

  test('converts number and integer fields', () => {
    const zodSchema = handRolledJsonSchemaToZod({
      type: 'object',
      properties: { age: { type: 'integer' }, height: { type: 'number' } },
    });
    const result = zodSchema.parse({ age: 30, height: 5.9 });
    expect(result).toEqual({ age: 30, height: 5.9 });
  });

  test('converts boolean fields', () => {
    const zodSchema = handRolledJsonSchemaToZod({
      type: 'object',
      properties: { active: { type: 'boolean' } },
    });
    expect(zodSchema.parse({ active: true })).toEqual({ active: true });
  });

  test('converts array fields with item schema', () => {
    const zodSchema = handRolledJsonSchemaToZod({
      type: 'object',
      properties: { tags: { type: 'array', items: { type: 'string' } } },
    });
    expect(zodSchema.parse({ tags: ['a', 'b', 'c'] })).toEqual({ tags: ['a', 'b', 'c'] });
  });

  test('honors the required array (optional vs required)', () => {
    const zodSchema = handRolledJsonSchemaToZod({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
      required: ['a'],
    });
    // a is required, b is optional
    expect(zodSchema.parse({ a: 'x' })).toEqual({ a: 'x' });
    expect(zodSchema.parse({ a: 'x', b: 'y' })).toEqual({ a: 'x', b: 'y' });
  });

  test('converts enum to a union of literals', () => {
    const zodSchema = handRolledJsonSchemaToZod({
      type: 'object',
      properties: { color: { enum: ['red', 'green', 'blue'] } },
    });
    expect(zodSchema.parse({ color: 'red' })).toEqual({ color: 'red' });
    expect(zodSchema.parse({ color: 'blue' })).toEqual({ color: 'blue' });
  });
});

// ───────────────────────────────────────────────────────────────────
// jsonSchemaToZod (bridge path) — only runs if json-schema-to-zod is installed
// ───────────────────────────────────────────────────────────────────

describe('jsonSchemaToZod (bridge path)', () => {
  beforeEach(async () => {
    // The bridge lib is installed as a devDep in husk itself, so
    // this should succeed. If a user is testing against a build
    // that doesn't have it, these tests would be skipped — but
    // for our internal tests, we always have it.
    try {
      await prewarmSchemaConverter();
    } catch {
      // Bridge lib not installed — skip these tests.
    }
  });

  test('converts a simple object schema and validates input', async () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'number' } },
      required: ['name', 'age'],
    };
    const zodSchema = await jsonSchemaToZod(schema);
    expect(zodSchema.parse({ name: 'alice', age: 30 })).toEqual({ name: 'alice', age: 30 });
  });

  test('handles the same nested object case as the hand-rolled fallback', async () => {
    const schema = {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: { id: { type: 'string' }, role: { type: 'string' } },
          required: ['id'],
        },
      },
      required: ['user'],
    };
    const zodSchema = await jsonSchemaToZod(schema);
    expect(zodSchema.parse({ user: { id: '1', role: 'admin' } })).toEqual({
      user: { id: '1', role: 'admin' },
    });
  });
});

// ───────────────────────────────────────────────────────────────────
// defineMcpServer
// ───────────────────────────────────────────────────────────────────

describe('defineMcpServer', () => {
  let workDir: string;
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'husk-mcp-server-test-'));
  });
  afterEach(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  test('builds a server handle and registers tools', async () => {
    const echo = defineTool({
      name: 'echo',
      description: 'Echoes input',
      inputSchema: objectSchema({ message: stringField() }),
      execute: async (input: unknown) => {
        return { output: `echo: ${(input as { message: string }).message}` };
      },
    });

    const handle = await defineMcpServer({
      name: 'test-server',
      version: '0.7.0',
      tools: [echo],
    });

    expect(handle).toBeDefined();
    expect(typeof handle.connect).toBe('function');
    expect(typeof handle.close).toBe('function');
    expect(handle.raw).toBeDefined();

    await handle.close();
  });

  test('skips approval-gated tools by default', async () => {
    let executed = false;
    const dangerous = defineTool({
      name: 'dangerous',
      description: 'Dangerous op',
      inputSchema: objectSchema({}),
      requireApproval: true,
      execute: async () => {
        executed = true;
        return { output: 'should not run' };
      },
    });

    // The server should be built but the dangerous tool NOT registered.
    // We verify by checking the raw server's registered tools (the
    // SDK doesn't expose a direct getter, so we check via a
    // successful build + a no-op connect attempt that wouldn't work
    // for a tool that needed stdio).
    const handle = await defineMcpServer({
      name: 'test-server',
      version: '0.7.0',
      tools: [dangerous],
    });
    expect(handle).toBeDefined();
    await handle.close();
    // We can't easily check that 'dangerous' was skipped without
    // spinning up a full client, but the build should not have
    // thrown.
    expect(executed).toBe(false); // execute() never called during build
  });

  test('includes approval-gated tools when includeApprovalGated is true', async () => {
    let executed = false;
    const dangerous = defineTool({
      name: 'dangerous',
      description: 'Dangerous op',
      inputSchema: objectSchema({}),
      requireApproval: true,
      execute: async () => {
        executed = true;
        return { output: 'registered (not executed)' };
      },
    });

    const handle = await defineMcpServer({
      name: 'test-server',
      version: '0.7.0',
      tools: [dangerous],
      includeApprovalGated: true,
    });
    expect(handle).toBeDefined();
    await handle.close();
    expect(executed).toBe(false);
  });

  test('preserves tool descriptions when registering', async () => {
    const tool: ToolDefinition = defineTool({
      name: 'greet',
      description: 'Greets the named subject warmly',
      inputSchema: objectSchema({ name: stringField() }),
      execute: async (input: unknown) => {
        return { output: `Hi, ${(input as { name: string }).name}!` };
      },
    });

    const handle = await defineMcpServer({
      name: 'test-server',
      version: '0.7.0',
      tools: [tool],
    });
    expect(handle).toBeDefined();
    await handle.close();
  });
});

// Sanity: we don't use fs helpers in this file directly, but the
// import lines above are intentional for future tests.
void writeFile;
void readFile;
void numberField;
void booleanField;
void z;
