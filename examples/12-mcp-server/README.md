# Example 12 — MCP server: expose Husk tools to Claude Desktop

Wraps Husk's built-in `Read` / `Write` / `Edit` / `Bash` / `Grep` tools as an MCP server. Run this file and point Claude Desktop at the stdio transport — your Husk tools become available to Claude as MCP tools.

## Setup

```bash
cd examples/12-mcp-server
bun add @modelcontextprotocol/sdk
```

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "husk": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/husk/examples/12-mcp-server/index.ts"]
    }
  }
}
```

Restart Claude Desktop. The Husk tools will appear in Claude's tools menu.

## What you'll see in Claude Desktop

- `read_file` (from Husk's `Read`)
- `write_file` (from Husk's `Write`)
- `edit` (from Husk's `Edit`)
- `bash` (from Husk's `Bash`)
- `grep` (from Husk's `Grep`)

Each tool's MCP `inputSchema` is generated from the Husk tool's `JSONSchema` via the JSONSchema → Zod adapter. The Zod schema is what the MCP SDK uses for runtime validation when Claude calls the tool.

## What this demonstrates

- **`defineMcpServer()`** wraps a Husk tool set as an MCP server in one call.
- **JSONSchema → Zod conversion** at the adapter boundary — Husk's tool definitions use `JSONSchema`; the MCP SDK's `registerTool` expects Zod (Standard Schema). The adapter handles the conversion transparently.
- **Stdio transport** is the standard way to integrate with Claude Desktop and other MCP clients that spawn servers as subprocesses.
- **Graceful shutdown** on SIGINT / SIGTERM so the child process cleans up properly.
- **Approval-gated tools are skipped by default** — `requireApproval: true` tools are excluded from the exposed surface, since MCP clients have no way to surface approval prompts. Override with `includeApprovalGated: true` for clients that handle approval natively.

## Library usage

```ts
import { defineMcpServer } from '@princetheprogrammerbtw/husk/mcp';
import { Read, Write, Edit, Bash, Grep } from '@princetheprogrammerbtw/husk';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = await defineMcpServer({
  name: 'my-husk-tools',
  version: '1.0.0',
  tools: [Read, Write, Edit, Bash, Grep],
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

## HTTP transport

For a hosted MCP server, swap the transport:

```ts
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => crypto.randomUUID(),
});
await server.connect(transport);
```

Now any MCP client (Claude Desktop, mcp-cli, custom agents) can connect to your hosted server.

## Custom tool sets

The example exposes the built-in Husk tools, but you can pass any `ToolDefinition[]`:

```ts
import { defineTool, objectSchema, stringField } from '@princetheprogrammerbtw/husk';

const myTool = defineTool({
  name: 'lookup_customer',
  description: 'Look up a customer by ID',
  inputSchema: objectSchema({ id: stringField() }),
  execute: async ({ id }) => ({ output: `Customer #${id}: ...` }),
});

const server = await defineMcpServer({
  name: 'my-crm-tools',
  version: '1.0.0',
  tools: [myTool],
});
```

Mix and match built-in tools, custom tools, and tools from other Husk extensions.

## Security notes

- **Path safety**: Husk's `Read` / `Write` / `Edit` are unscoped by default — they read/write anywhere. Add `validate: pathAllowed({ baseDir: process.cwd() })` if you want to restrict to a specific directory.
- **Bash safety**: Husk's `Bash` has a small denylist but isn't a full sandbox. For production use, consider writing a custom Bash wrapper that validates commands.
- **Network access**: `Read` and `Grep` follow symlinks and access the local filesystem. If you don't want that, override or remove them.
- **Approval-gated tools**: Excluded by default for safety. If you set `includeApprovalGated: true`, the MCP client controls whether the call proceeds — make sure yours handles approval correctly.

## How it works internally

`defineMcpServer()` does the following:

1. **Lazy-loads the MCP SDK** (`@modelcontextprotocol/sdk/server/mcp.js`) — 4.2MB unpacked, only paid by users who opt in.
2. **Lazy-loads json-schema-to-zod** — bridges Husk's `JSONSchema` to the Zod schema the SDK's `McpServer.registerTool()` expects. Falls back to a hand-rolled converter if the bridge lib isn't installed.
3. **Iterates over the Husk tools**, converts each schema, and calls `sdkServer.registerTool(name, { inputSchema: zodSchema }, callback)`.
4. **Skips `requireApproval: true` tools** unless `includeApprovalGated: true` is set. Exposing an approval-gated tool over MCP is a security hole — the MCP client has no way to surface the approval prompt.
5. **Returns a `McpServerHandle`** wrapping the raw SDK server with `connect()` and `close()` methods. User picks the transport (stdio, HTTP, etc.) and connects.

The MCP server is then a real, JSON-RPC-speaking server that any MCP-compatible client can call. Husk's tool semantics (validation, execution, error handling) are preserved 1:1.
