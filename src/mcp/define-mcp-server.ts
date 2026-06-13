/**
 * Husk — `defineMcpServer()` adapter.
 *
 * The mirror of v0.6.0's defineMcpTools(). Wraps a Husk tool set
 * as an MCP server, so the same tools can be exposed to any
 * MCP-compatible client (Claude Desktop, custom agents, etc.).
 *
 * Flow:
 *   1. User passes an array of Husk tools to defineMcpServer()
 *   2. For each tool, convert its JSONSchema to a Zod schema
 *      (via the schema-adapter)
 *   3. Create an SDK McpServer and register each tool
 *   4. Return the McpServer — user connects it to a transport
 *      (StdioServerTransport for CLI use, StreamableHTTPServer-
 *      Transport for hosted use)
 *
 * Usage:
 *
 *   import { defineMcpServer } from '@princetheprogrammerbtw/husk/mcp';
 *   import { Read, Write, Edit, Bash, Grep } from '@princetheprogrammerbtw/husk';
 *
 *   const server = await defineMcpServer({
 *     name: 'husk-tools',
 *     version: '0.7.0',
 *     tools: [Read, Write, Edit, Bash, Grep],
 *   });
 *
 *   // stdio transport (for Claude Desktop / mcp-cli):
 *   const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
 *   await server.connect(new StdioServerTransport());
 *
 *   // OR HTTP transport (for hosted MCP servers):
 *   const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
 *   await server.connect(new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() }));
 */

import { McpClientError } from './client-error.js';
import { type AnyZodSchema, handRolledJsonSchemaToZod, jsonSchemaToZod } from './schema-adapter.js';
import type { McpServerConfig, McpServerHandle } from './types.js';

/** Minimal shape we use from the MCP SDK. */
interface McpSdkServer {
  registerTool(
    name: string,
    config: { description?: string; inputSchema: AnyZodSchema },
    callback: (
      args: Record<string, unknown>,
    ) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>,
  ): void;
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
}

interface SdkServerCache {
  McpServer: new (info: { name: string; version: string }) => McpSdkServer;
}

let sdkCache: SdkServerCache | undefined;

async function loadServerSdk(): Promise<SdkServerCache> {
  if (sdkCache) return sdkCache;
  try {
    const mod = (await import('@modelcontextprotocol/sdk/server/index.js')) as Record<
      string,
      unknown
    >;
    sdkCache = { McpServer: mod.Server as unknown as SdkServerCache['McpServer'] };
    return sdkCache;
  } catch (err) {
    if (err instanceof Error && /Cannot find module/.test(err.message)) {
      throw new McpClientError(
        "The MCP SDK isn't installed. Run `npm install @modelcontextprotocol/sdk` and try again. The SDK is an optional peer dep — Husk doesn't force it on you unless you use the /mcp subpath.",
        'SDK_MISSING',
      );
    }
    throw err;
  }
}

/**
 * Build an MCP server from a set of Husk tools. Returns a
 * `McpServerHandle` that exposes the underlying SDK server
 * (so you can connect it to any transport) plus convenience
 * methods for the common cases.
 *
 * Tools with `requireApproval: true` are NOT registered by
 * default — exposing an approval-gated tool as MCP would be
 * a security hole (the MCP client has no way to surface the
 * approval prompt). Pass `includeApprovalGated: true` to
 * include them anyway.
 */
export async function defineMcpServer(config: McpServerConfig): Promise<McpServerHandle> {
  const sdk = await loadServerSdk();
  const sdkServer = new sdk.McpServer({ name: config.name, version: config.version });

  // Try the bridge library first; fall back to hand-rolled if
  // it's not installed. We track which path we used so the
  // error messages can point at the right upgrade.
  let useBridgeLib = true;
  let bridgeError: Error | undefined;
  try {
    for (const tool of config.tools) {
      if (tool.requireApproval && !config.includeApprovalGated) {
        continue; // skip approval-gated tools by default
      }
      let zodSchema: AnyZodSchema;
      try {
        zodSchema = await jsonSchemaToZod(tool.inputSchema);
      } catch (err) {
        if (err instanceof Error && /json-schema-to-zod/.test(err.message)) {
          // Bridge lib not installed — fall back to hand-rolled.
          useBridgeLib = false;
          bridgeError = err;
          zodSchema = handRolledJsonSchemaToZod(tool.inputSchema);
        } else {
          throw err;
        }
      }
      sdkServer.registerTool(
        tool.name,
        {
          ...(tool.description ? { description: tool.description } : {}),
          inputSchema: zodSchema,
        },
        async (args: Record<string, unknown>) => {
          try {
            const result = await tool.execute(args, { signal: undefined, logger: undefined });
            return {
              content: [{ type: 'text' as const, text: result.output }],
              ...(result.isError ? { isError: true } : {}),
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              content: [
                { type: 'text' as const, text: `Error executing tool '${tool.name}': ${message}` },
              ],
              isError: true,
            };
          }
        },
      );
    }
  } catch (err) {
    throw new McpClientError(
      `Failed to build MCP server: ${err instanceof Error ? err.message : String(err)}`,
      'SDK_LOAD_FAILED',
    );
  }

  if (!useBridgeLib && bridgeError) {
    // The hand-rolled fallback is in use. Surface a soft warning
    // so the user knows to install the bridge lib for full
    // schema fidelity.
    // eslint-disable-next-line no-console
    console.warn(
      `[husk/mcp] Using hand-rolled JSONSchema → Zod fallback. Install 'json-schema-to-zod' for full schema fidelity: ${bridgeError.message}`,
    );
  }

  return {
    /** The underlying SDK server. Use .connect() with a transport. */
    raw: sdkServer,
    /** Connect to a transport. Same shape as the SDK's connect(). */
    async connect(transport: unknown): Promise<void> {
      await sdkServer.connect(transport);
    },
    /** Close the server. Idempotent. */
    async close(): Promise<void> {
      try {
        await sdkServer.close();
      } catch {
        // best-effort
      }
    },
  };
}
