/**
 * Husk — MCP (Model Context Protocol) adapter.
 *
 * v0.6.0 ships a CLIENT adapter: connect to any MCP-compatible
 * server (filesystem, github, postgres, custom) and use its tools
 * as Husk tools. The SERVER adapter is the natural follow-up but
 * deferred to v0.7.0 — the client side is the more common ask.
 *
 * Why a separate subpath: the @modelcontextprotocol/sdk is 4.2MB
 * unpacked. We don't want to force every Husk user to install it.
 * The peer dep is optional; importing from '@princetheprogrammerbtw/husk/mcp'
 * pulls the SDK in only for users who opt in.
 *
 * Quick start:
 *
 *   import { McpClient, defineMcpTools } from '@princetheprogrammerbtw/husk/mcp';
 *
 *   const client = new McpClient({
 *     transport: 'stdio',
 *     command: 'npx',
 *     args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
 *   });
 *   await client.connect();
 *
 *   const tools = await defineMcpTools(client);
 *   const agent = new Agent({ model: provider, tools });
 *   await agent.run('List files in /tmp');
 *
 *   await client.disconnect();
 */

export { McpClient } from './client.js';
export { McpClientError } from './client-error.js';
export type { McpClientErrorCode } from './client-error.js';
export type { McpClientConfig, McpStdioConfig, McpHttpConfig } from './types.js';
export { defineMcpTools } from './define-mcp-tools.js';
export type { DefineMcpToolsOptions } from './define-mcp-tools.js';
export type { McpToolDefinition, McpToolInput, McpToolResult } from './types.js';
