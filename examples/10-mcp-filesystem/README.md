# Example 10 — MCP filesystem client

Connects to a real `@modelcontextprotocol/server-filesystem` subprocess over stdio, fetches its tool list, and wraps each tool as a Husk `ToolDefinition`. The agent then uses those tools alongside a Husk-native `echo` tool to answer a real prompt.

## Setup

```bash
cd examples/10-mcp-filesystem
bun add @modelcontextprotocol/sdk @modelcontextprotocol/server-filesystem
ANTHROPIC_API_KEY=sk-ant-... bun run index.ts /tmp
```

The first argument is the directory the filesystem MCP server is allowed to expose. Husk adds its own `pathAllowed()` validation on top of that scope, so the model can never escape even if the server has a bug.

## What you'll see

```
→ MCP filesystem demo
→ Allowed root: /tmp

✓ Connected to filesystem MCP server

→ Server exposes 14 tools:
    - read_file: Read the complete contents of a file...
    - write_file: Create or overwrite a file...
    - list_directory: List directory contents...
    - create_directory: Create a new directory...
    - move_file: Move or rename a file...
    ...

→ Prompt: "List the files in /tmp, then read the first .md file you find..."

--- agent output ---

[agent uses fs_list_directory, then fs_read_file, then echo]

--- end ---

Iterations: 3
Tokens:     432 in / 87 out
✓ Disconnected from MCP server
```

## What this demonstrates

- **`McpClient.connect()` with a stdio transport** — spawns the MCP server as a child process, speaks JSON-RPC over its stdio.
- **`defineMcpTools()` to wrap the server's tools for Husk** — one call, the agent sees the same `ToolDefinition[]` shape regardless of where the tool originated.
- **`namePrefix: 'fs_'`** to disambiguate when combining multiple MCP servers. The prefix only affects the Husk name; calls to the MCP server use the original name.
- **Local validation with `pathAllowed()`** as a belt-and-suspenders sandbox. The MCP server is already scoped to the allowed root, but Husk adds its own check so a bug in the server (or a future tool that doesn't enforce its own scope) can't escape.
- **Husk-native + MCP tools compose cleanly** — the example adds a plain `echo` tool alongside the MCP ones, and the model picks whichever fits the task.
- **Graceful `disconnect()` in a try/finally** so the spawned npx subprocess always gets reaped, even if the agent throws.

## Library usage

```ts
import { Agent, AnthropicProvider } from '@princetheprogrammerbtw/husk';
import { McpClient, defineMcpTools } from '@princetheprogrammerbtw/husk/mcp';

const client = new McpClient({
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
});
await client.connect();

const tools = await defineMcpTools(client, { namePrefix: 'fs_' });
const agent = new Agent({ model: new AnthropicProvider(), tools });

await agent.run('List /tmp and read the first .md file');
await client.disconnect();
```

## HTTP transport

Same client, different config:

```ts
const client = new McpClient({
  transport: 'http',
  url: 'https://my-mcp-server.example.com/mcp',
  headers: { Authorization: `Bearer ${process.env.MCP_TOKEN}` },
});
```

The `McpClient` class is the single abstraction over both transports — switching is a one-line config change.

## How it works internally

`McpClient` dynamically imports `@modelcontextprotocol/sdk` on first use (the SDK is 4.2MB unpacked, so we lazy-load it to keep Husk's main bundle small). It wraps the SDK's `Client` class with a Husk-friendly surface (`listTools()`, `callTool()`, `disconnect()`) and translates errors into `McpClientError` with machine-readable codes.

`defineMcpTools()` is a thin adapter: it fetches the tool list, maps each MCP tool to a Husk `ToolDefinition` (preserving the schema, description, and name), and wraps `callTool()` to convert Husk's `ToolResult` to/from the MCP response shape. The validation rules are attached to the `ToolDefinition` so the agent loop runs them before forwarding the call to the server.

The original MCP tool name (e.g. `read_file`) is what's actually called on the server — the Husk-side name prefix is cosmetic. This way multiple MCP servers with overlapping tool names can coexist without renaming on either side.

## What's NOT in v0.6.0

The **server** side (exposing Husk tools as an MCP server) is the natural follow-up but deferred to v0.7.0. The client side is the more common ask — most users want to consume the MCP ecosystem (filesystem, github, postgres, etc.) rather than publish their own.

If you need server-side, the `@modelcontextprotocol/sdk` ships a `McpServer` class that you can wire up directly. The Husk adapter would just be a thin wrapper that maps Husk tools to MCP tool definitions.
