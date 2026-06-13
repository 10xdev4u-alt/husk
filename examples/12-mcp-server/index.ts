/**
 * Example 12 — MCP server: expose Husk tools to Claude Desktop.
 *
 * Wraps Husk's built-in Read / Write / Edit / Bash / Grep tools
 * as an MCP server. Run this file and point Claude Desktop at
 * the stdio transport — your Husk tools become available to
 * Claude as MCP tools.
 *
 * Setup (one-time):
 *   cd examples/12-mcp-server
 *   bun add @modelcontextprotocol/sdk
 *   Add to ~/Library/Application Support/Claude/claude_desktop_config.json:
 *     {
 *       "mcpServers": {
 *         "husk": {
 *           "command": "bun",
 *           "args": ["run", "/absolute/path/to/husk/examples/12-mcp-server/index.ts"]
 *         }
 *       }
 *     }
 *   Restart Claude Desktop. The Husk tools will appear in the
 *   'tools' menu.
 *
 * What you'll see in Claude Desktop:
 *   - read_file    (from Husk's Read)
 *   - write_file   (from Husk's Write)
 *   - edit         (from Husk's Edit)
 *   - bash         (from Husk's Bash)
 *   - grep         (from Husk's Grep)
 *
 * Each tool's MCP inputSchema is generated from the Husk tool's
 * JSONSchema via the JSONSchema → Zod adapter. The Zod schema
 * is what the MCP SDK uses for runtime validation when Claude
 * calls the tool.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Bash, Edit, Grep, Read, Write } from '../../src/index.js';
import { defineMcpServer } from '../../src/mcp/index.js';

async function main() {
  console.error('[husk-mcp] building server from Husk tools...');

  const server = await defineMcpServer({
    name: 'husk-builtin-tools',
    version: '0.7.0',
    tools: [Read, Write, Edit, Bash, Grep],
    // Exclude approval-gated tools by default. The Bash tool has
    // a denylist + size cap but no approval gate today, so this
    // is mostly a no-op — but if you customize with a Bash that
    // has requireApproval: true, the flag keeps it off the
    // exposed surface.
  });

  console.error('[husk-mcp] server built. connecting to stdio...');

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[husk-mcp] connected. waiting for MCP messages on stdio...');

  // The server runs until stdin closes (parent process exits).
  // Graceful shutdown on SIGINT / SIGTERM.
  const shutdown = async (signal: string) => {
    console.error(`[husk-mcp] received ${signal}, closing...`);
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[husk-mcp] fatal:', err);
  process.exit(1);
});
