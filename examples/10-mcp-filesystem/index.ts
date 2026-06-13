/**
 * Example 10 — MCP filesystem client.
 *
 * Connects to a real @modelcontextprotocol/server-filesystem
 * subprocess over stdio, fetches its tool list, and wraps each
 * tool as a Husk ToolDefinition. The agent then uses those tools
 * to answer a prompt.
 *
 * Setup:
 *   cd examples/10-mcp-filesystem
 *   bun add @modelcontextprotocol/server-filesystem
 *   bun run index.ts /tmp    # pass a directory to expose as the
 *                            # filesystem root
 *
 * What this demonstrates:
 *   - McpClient.connect() with a stdio transport (spawns a child
 *     process and speaks JSON-RPC over its stdio)
 *   - defineMcpTools() to wrap the server's tools for Husk
 *   - namePrefix for disambiguation when combining multiple MCP
 *     servers
 *   - pathAllowed() validation to sandbox MCP tools to a base dir
 *   - Graceful disconnect() in a try/finally so the child process
 *     always gets reaped
 */

import { Agent, AnthropicProvider, defineTool } from '../../src/index.js';
import { McpClient, defineMcpTools } from '../../src/mcp/index.js';
import { objectSchema, stringField } from '../../src/tools/registry.js';
import { pathAllowed } from '../../src/tools/validation.js';

const ALLOWED_ROOT = process.argv[2] ?? '/tmp';

async function main() {
  console.log('\n→ MCP filesystem demo');
  console.log(`\n→ Allowed root: ${ALLOWED_ROOT}\n`);

  // Spawn the filesystem MCP server over stdio. The server
  // takes one arg: the directory it's allowed to expose.
  const client = new McpClient({
    name: 'husk-fs-client',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', ALLOWED_ROOT],
  });

  try {
    await client.connect();
    console.log('✓ Connected to filesystem MCP server\n');

    // Fetch the server's tool list. For the filesystem server this
    // is typically: read_file, write_file, list_directory,
    // create_directory, move_file, etc.
    const mcpTools = await client.listTools();
    console.log(`→ Server exposes ${mcpTools.length} tools:`);
    for (const t of mcpTools) {
      console.log(`    - ${t.name}${t.description ? `: ${t.description}` : ''}`);
    }
    console.log();

    // Wrap them as Husk tools. We add:
    //   - namePrefix 'fs_' so it's clear in the model context which
    //     tools come from the filesystem MCP server
    //   - pathAllowed validation on the tools that take a path arg,
    //     as a local sandbox even if the server is more permissive
    const tools = await defineMcpTools(client, {
      namePrefix: 'fs_',
      validate: {
        // Belt + suspenders: the server is already scoped to
        // ALLOWED_ROOT, but a second layer of validation means a
        // bug in the server (or a future tool that doesn't enforce
        // its own scope) can't escape.
        read_file: pathAllowed({ baseDir: ALLOWED_ROOT }),
        write_file: [pathAllowed({ baseDir: ALLOWED_ROOT })],
        move_file: pathAllowed({ baseDir: ALLOWED_ROOT }),
      },
    });

    // Add a Husk-native tool alongside the MCP ones, to show they
    // compose cleanly.
    const echo: ReturnType<typeof defineTool> = defineTool({
      name: 'echo',
      description: 'Echoes back the input (Husk-native, not from MCP)',
      inputSchema: objectSchema({ message: stringField() }),
      execute: async (input: unknown) => {
        return { output: `echo: ${(input as { message: string }).message}` };
      },
    });
    tools.push(echo as (typeof tools)[number]);

    // Run the agent. The model will see both fs_* MCP tools and
    // the native echo tool and pick whichever fits the prompt.
    const agent = new Agent({
      model: new AnthropicProvider({ model: 'claude-opus-4-6' }),
      tools,
    });

    const prompt = `List the files in ${ALLOWED_ROOT}, then read the first .md file you find, and echo back a 1-sentence summary.`;
    console.log(`→ Prompt: "${prompt}"\n`);
    console.log('--- agent output ---\n');

    const result = await agent.run(prompt);
    console.log('\n--- end ---\n');
    console.log(`Iterations: ${result.iterations}`);
    console.log(`Tokens:     ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`);
  } finally {
    // Always disconnect — kills the spawned npx subprocess.
    await client.disconnect();
    console.log('✓ Disconnected from MCP server');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
