/**
 * Tests for the v0.6.0 MCP adapter.
 *
 * Coverage:
 *   - McpClientError: code propagation, name, instanceof
 *   - McpClient: not-connected errors, double-connect, disconnect idempotent
 *   - defineMcpTools: requires connected client, wraps tools correctly,
 *     prefixing, validation rules
 *
 * We don't spawn real MCP servers in these tests (would need a
 * separate process + stdio plumbing). The integration test
 * against a real @modelcontextprotocol/server lives in
 * examples/10-mcp-filesystem and is smoke-tested manually.
 *
 * For defineMcpTools we test against a hand-rolled object that
 * satisfies the McpClient interface (just the methods we need).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ToolDefinition } from '../src/core/types.js';
import { McpClient, McpClientError, defineMcpTools } from '../src/mcp/index.js';
import type { McpToolDefinition } from '../src/mcp/types.js';

// ───────────────────────────────────────────────────────────────────
// McpClientError
// ───────────────────────────────────────────────────────────────────

describe('McpClientError', () => {
  test('carries a machine-readable code', () => {
    const err = new McpClientError('test', 'NOT_CONNECTED');
    expect(err.code).toBe('NOT_CONNECTED');
    expect(err.name).toBe('McpClientError');
    expect(err.message).toBe('test');
  });

  test('is an Error instance and a McpClientError instance', () => {
    const err = new McpClientError('x', 'SDK_MISSING');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(McpClientError);
  });
});

// ───────────────────────────────────────────────────────────────────
// McpClient — not-connected / lifecycle
// ───────────────────────────────────────────────────────────────────

describe('McpClient — lifecycle', () => {
  let client: McpClient;

  beforeEach(() => {
    client = new McpClient({
      transport: 'stdio',
      command: 'true', // a no-op binary on POSIX systems
    });
  });

  afterEach(async () => {
    await client.disconnect();
  });

  test('isConnected() is false before connect()', () => {
    expect(client.isConnected()).toBe(false);
  });

  test('listTools() throws NOT_CONNECTED before connect()', async () => {
    await expect(client.listTools()).rejects.toThrow(McpClientError);
    try {
      await client.listTools();
    } catch (err) {
      expect((err as McpClientError).code).toBe('NOT_CONNECTED');
    }
  });

  test('callTool() throws NOT_CONNECTED before connect()', async () => {
    await expect(client.callTool('x')).rejects.toThrow(McpClientError);
  });

  test('disconnect() is idempotent (safe to call twice)', async () => {
    await client.disconnect();
    await client.disconnect();
    expect(client.isConnected()).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────
// defineMcpTools — fake client (no real subprocess needed)
// ───────────────────────────────────────────────────────────────────

/**
 * A minimal in-process stand-in for McpClient that satisfies the
 * surface defineMcpTools uses. We can't import the real class and
 * monkey-patch its private state, so we build a tiny duck-typed
 * object instead.
 */
class FakeMcpClient {
  connected = true;
  listToolsResult: McpToolDefinition[] = [];
  callToolResult: { text?: string; isError?: boolean } = { text: 'ok' };
  callToolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  isConnected(): boolean {
    return this.connected;
  }

  async listTools(): Promise<McpToolDefinition[]> {
    return this.listToolsResult;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ text?: string; isError?: boolean }> {
    this.callToolCalls.push({ name, args });
    return this.callToolResult;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }
}

describe('defineMcpTools', () => {
  test('throws if the client is not connected', async () => {
    const client = new FakeMcpClient();
    client.connected = false;
    await expect(defineMcpTools(client as unknown as McpClient)).rejects.toThrow(/not connected/i);
  });

  test('returns a Husk ToolDefinition for each MCP tool', async () => {
    const client = new FakeMcpClient();
    client.listToolsResult = [
      {
        name: 'read_file',
        description: 'Read a file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      },
      {
        name: 'write_file',
        description: 'Write a file',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' }, content: { type: 'string' } },
        },
      },
    ];
    const tools = await defineMcpTools(client as unknown as McpClient);
    expect(tools).toHaveLength(2);
    expect(tools[0]?.name).toBe('read_file');
    expect(tools[0]?.description).toBe('Read a file');
    expect(tools[1]?.name).toBe('write_file');
  });

  test('uses the original tool name for callTool (no prefix in the call)', async () => {
    const client = new FakeMcpClient();
    client.listToolsResult = [
      { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } },
    ];
    const tools = await defineMcpTools(client as unknown as McpClient, { namePrefix: 'fs_' });
    expect(tools[0]?.name).toBe('fs_read_file');
    // Execute the wrapped tool — should call the ORIGINAL name, not the prefixed one.
    await tools[0]?.execute({ path: '/tmp/foo' }, { signal: undefined, logger: undefined });
    expect(client.callToolCalls).toHaveLength(1);
    expect(client.callToolCalls[0]?.name).toBe('read_file'); // not 'fs_read_file'
    expect(client.callToolCalls[0]?.args).toEqual({ path: '/tmp/foo' });
  });

  test('execute returns the text content as output', async () => {
    const client = new FakeMcpClient();
    client.listToolsResult = [
      { name: 'echo', description: 'Echo', inputSchema: { type: 'object' } },
    ];
    client.callToolResult = { text: 'hello back' };
    const tools = await defineMcpTools(client as unknown as McpClient);
    const result = await tools[0]?.execute({}, { signal: undefined, logger: undefined });
    expect(result?.output).toBe('hello back');
    expect(result?.isError).toBeUndefined();
  });

  test('execute surfaces isError from the MCP response', async () => {
    const client = new FakeMcpClient();
    client.listToolsResult = [
      { name: 'bad', description: 'Always errors', inputSchema: { type: 'object' } },
    ];
    client.callToolResult = { text: 'something went wrong', isError: true };
    const tools = await defineMcpTools(client as unknown as McpClient);
    const result = await tools[0]?.execute({}, { signal: undefined, logger: undefined });
    expect(result?.isError).toBe(true);
    expect(result?.output).toBe('something went wrong');
  });

  test('execute returns a clean error when the call throws', async () => {
    const client = new FakeMcpClient();
    client.listToolsResult = [
      { name: 'crash', description: 'Crashes', inputSchema: { type: 'object' } },
    ];
    client.callTool = async (): Promise<{ text?: string; isError?: boolean }> => {
      throw new Error('ECONNRESET');
    };
    const tools = await defineMcpTools(client as unknown as McpClient);
    const result = await tools[0]?.execute({}, { signal: undefined, logger: undefined });
    expect(result?.isError).toBe(true);
    expect(result?.output).toContain('ECONNRESET');
  });

  test('empty tool list returns empty array (no crash)', async () => {
    const client = new FakeMcpClient();
    client.listToolsResult = [];
    const tools = await defineMcpTools(client as unknown as McpClient);
    expect(tools).toEqual([]);
  });

  test('handles non-object input by passing empty args', async () => {
    const client = new FakeMcpClient();
    client.listToolsResult = [{ name: 'x', description: 'x', inputSchema: { type: 'object' } }];
    const tools = await defineMcpTools(client as unknown as McpClient);
    // @ts-expect-error — testing the runtime safety net
    await tools[0]?.execute(null, { signal: undefined, logger: undefined });
    expect(client.callToolCalls[0]?.args).toEqual({});
  });
});

// ───────────────────────────────────────────────────────────────────
// defineMcpTools — validation rules
// ───────────────────────────────────────────────────────────────────

describe('defineMcpTools — validation rules', () => {
  test('attaches validation rules to the wrapped tool', async () => {
    const client = new FakeMcpClient();
    client.listToolsResult = [
      { name: 'read_file', description: 'Read', inputSchema: { type: 'object' } },
    ];
    const pathCheck = { name: 'path-allowed', check: () => null };
    const tools = await defineMcpTools(client as unknown as McpClient, {
      validate: { read_file: pathCheck as unknown as ToolDefinition['validate'] },
    });
    expect(tools[0]?.validate).toBe(pathCheck);
  });

  test('validation rules run before the call (via the agent loop)', async () => {
    // The agent loop is what actually runs the validate? rule, not
    // the wrapped tool's execute(). This test just confirms the
    // rule is attached; the integration test in tests/validation.test.ts
    // covers the full validation flow.
    const client = new FakeMcpClient();
    client.listToolsResult = [
      { name: 'dangerous', description: 'Dangerous', inputSchema: { type: 'object' } },
    ];
    let ruleRan = false;
    const rule = {
      name: 'block',
      check: () => {
        ruleRan = true;
        return 'blocked';
      },
    };
    const tools = await defineMcpTools(client as unknown as McpClient, {
      validate: { dangerous: rule as unknown as ToolDefinition['validate'] },
    });
    expect(tools[0]?.validate).toBeDefined();
    // The execute path itself doesn't run validate (the agent loop does).
    // We just confirm the rule is attached and the call would still
    // go through if validate passed.
    await tools[0]?.execute({}, { signal: undefined, logger: undefined });
    expect(ruleRan).toBe(false); // never ran in execute()
    expect(client.callToolCalls).toHaveLength(1); // call still happened
  });
});
