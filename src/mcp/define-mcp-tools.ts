/**
 * Husk — `defineMcpTools()` adapter.
 *
 * Fetches the tool list from a connected McpClient and wraps each
 * MCP tool as a Husk `ToolDefinition`. The resulting array can be
 * passed straight to `new Agent({ tools })`.
 *
 * Each wrapped tool:
 *   - name / description / inputSchema: copied from MCP
 *   - validate: optional — pass validators to enforce local safety
 *     rules before forwarding the call to the MCP server
 *   - execute: calls McpClient.callTool() and returns the result as
 *     a Husk ToolResult (text content as output, isError if the
 *     server reported an error)
 *
 * The MCP client must be connected before calling this function.
 * Disconnect is the caller's responsibility (typically right before
 * the agent process exits).
 *
 * Usage:
 *
 *   const client = new McpClient({ transport: 'stdio', command: 'npx', args: [...] });
 *   await client.connect();
 *   const tools = await defineMcpTools(client);
 *   // tools is an array of Husk ToolDefinition, ready for Agent.
 *   // ... do agent work ...
 *   await client.disconnect();
 */

import type { ToolDefinition } from '../core/types.js';
import type { ValidationRuleSet } from '../tools/validation.js';
import { McpClientError } from './client-error.js';
import type { McpClient } from './client.js';

export interface DefineMcpToolsOptions {
  /**
   * Optional map of tool-name → validation rules. Rules run locally
   * (in the Husk process) BEFORE the call is forwarded to the MCP
   * server. Useful for sandboxing: e.g. block read_file on paths
   * outside the project root, even if the MCP server is more
   * permissive.
   */
  readonly validate?: Readonly<Record<string, ValidationRuleSet>>;
  /**
   * Optional prefix prepended to every tool name (e.g. 'fs_' would
   * turn 'read_file' into 'fs_read_file'). Useful when combining
   * tools from multiple MCP servers to avoid name collisions.
   */
  readonly namePrefix?: string;
}

/**
 * Convert a connected McpClient's tool list into Husk ToolDefinitions.
 * Throws if the client isn't connected.
 */
export async function defineMcpTools(
  client: McpClient,
  options: DefineMcpToolsOptions = {},
): Promise<ToolDefinition[]> {
  if (!client.isConnected()) {
    throw new McpClientError('McpClient is not connected. Call connect() first.', 'NOT_CONNECTED');
  }
  const mcpTools = await client.listTools();
  return mcpTools.map((mcpTool) => {
    const prefixedName = options.namePrefix ? `${options.namePrefix}${mcpTool.name}` : mcpTool.name;
    const validation = options.validate?.[mcpTool.name];
    return {
      name: prefixedName,
      ...(mcpTool.description
        ? { description: mcpTool.description }
        : { description: `MCP tool: ${mcpTool.name}` }),
      inputSchema: mcpTool.inputSchema,
      ...(validation ? { validate: validation } : {}),
      execute: async (input: unknown): Promise<{ output: string; isError?: boolean }> => {
        const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
        try {
          const result = await client.callTool(mcpTool.name, args);
          const text =
            result.text ??
            (result.structured !== undefined ? JSON.stringify(result.structured) : '');
          return {
            output: text || '(no output)',
            ...(result.isError ? { isError: true } : {}),
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { output: `Error calling MCP tool '${mcpTool.name}': ${message}`, isError: true };
        }
      },
    } satisfies ToolDefinition;
  });
}
