/**
 * Husk — MCP client.
 *
 * Wraps @modelcontextprotocol/sdk's Client + a transport (Stdio or
 * HTTP) and exposes a Husk-friendly API:
 *
 *   await client.connect();
 *   const tools = await client.listTools();
 *   const result = await client.callTool('read_file', { path: '/tmp/x' });
 *   await client.disconnect();
 *
 * The SDK is dynamically imported on first use so users who never
 * touch the /mcp subpath don't pay the 4.2MB cost.
 *
 * Throws McpClientError on:
 *   - SDK not installed (peer dep missing)
 *   - Connection failure (process spawn failure, HTTP error)
 *   - Protocol error (malformed response, unexpected shape)
 *   - Tool call failure (server reports tool error)
 */

import { McpClientError } from './client-error.js';
import type { McpClientConfig, McpToolDefinition, McpToolResult } from './types.js';

/**
 * Minimal shape we use from the MCP SDK. We type it locally instead
 * of importing from @modelcontextprotocol/sdk so the type-check
 * doesn't require the SDK to be installed (it's an optional peer).
 */
interface McpSdkClient {
  connect(transport: unknown): Promise<void>;
  listTools(): Promise<{
    tools: Array<{ name: string; description?: string; inputSchema: unknown }>;
  }>;
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<{
    content: Array<{ type: string; text?: string }>;
    isError?: boolean;
    structuredContent?: unknown;
  }>;
  close(): Promise<void>;
}

interface McpSdkTransport {
  // Marker interface — concrete shape comes from the SDK.
  readonly [k: string]: unknown;
}

/** Internal cache for the dynamically-imported SDK modules. */
interface SdkCache {
  Client: new (info: { name: string; version: string }) => McpSdkClient;
  StdioClientTransport: new (params: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }) => McpSdkTransport;
  StreamableHTTPClientTransport: new (
    url: URL,
    options?: { requestInit?: { headers?: Record<string, string> } },
  ) => McpSdkTransport;
}

let sdkCache: SdkCache | undefined;

/**
 * Dynamically import the MCP SDK. The SDK is an optional peer dep;
 * if it's not installed we throw a helpful error pointing the user
 * to `npm install @modelcontextprotocol/sdk`.
 */
async function loadSdk(): Promise<SdkCache> {
  if (sdkCache) return sdkCache;
  try {
    // The SDK is split into ./client, ./server, ./client/stdio,
    // ./client/streamableHttp. We import lazily so the cost is paid
    // only by users who actually use the /mcp subpath.
    const mod = (await import('@modelcontextprotocol/sdk/client/index.js')) as Record<
      string,
      unknown
    >;
    const StdioMod = (await import('@modelcontextprotocol/sdk/client/stdio.js')) as Record<
      string,
      unknown
    >;
    const HttpMod = (await import('@modelcontextprotocol/sdk/client/streamableHttp.js')) as Record<
      string,
      unknown
    >;
    sdkCache = {
      Client: mod.Client as SdkCache['Client'],
      StdioClientTransport: StdioMod.StdioClientTransport as SdkCache['StdioClientTransport'],
      StreamableHTTPClientTransport:
        HttpMod.StreamableHTTPClientTransport as SdkCache['StreamableHTTPClientTransport'],
    };
    return sdkCache;
  } catch (err) {
    if (err instanceof Error && /Cannot find module/.test(err.message)) {
      throw new McpClientError(
        "The MCP SDK isn't installed. Run `npm install @modelcontextprotocol/sdk` and try again. The SDK is an optional peer dep — Husk doesn't force it on you unless you use the /mcp subpath.",
        'SDK_MISSING',
      );
    }
    throw new McpClientError(
      `Failed to load the MCP SDK: ${err instanceof Error ? err.message : String(err)}`,
      'SDK_LOAD_FAILED',
    );
  }
}

export class McpClient {
  private readonly config: McpClientConfig;
  private sdkClient: McpSdkClient | undefined;
  private connected = false;
  /** Display name for logs and the JSON-RPC `clientInfo` field. */
  private readonly displayName: string;

  constructor(config: McpClientConfig) {
    this.config = config;
    this.displayName = config.name ?? 'husk-mcp-client';
  }

  /** True if the client is currently connected. */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Connect to the MCP server. Spawns a child process for stdio, or
   * opens an HTTP connection for the HTTP transport. Safe to call
   * once; calling twice throws.
   */
  async connect(): Promise<void> {
    if (this.connected) {
      throw new McpClientError('Already connected. Call disconnect() first.', 'ALREADY_CONNECTED');
    }
    const sdk = await loadSdk();
    const transport = this.buildTransport(sdk);
    this.sdkClient = new sdk.Client({ name: this.displayName, version: '0.6.0' });
    try {
      await this.sdkClient.connect(transport);
      this.connected = true;
    } catch (err) {
      this.sdkClient = undefined;
      const message = err instanceof Error ? err.message : String(err);
      throw new McpClientError(
        `Failed to connect to MCP server (${this.configLabel()}): ${message}`,
        'CONNECT_FAILED',
      );
    }
  }

  /**
   * Fetch the list of tools the server exposes. Each tool comes
   * back with a name, description, and inputSchema (as JSON Schema).
   */
  async listTools(): Promise<readonly McpToolDefinition[]> {
    this.assertConnected();
    try {
      const response = await this.sdkClient?.listTools();
      if (!response)
        throw new McpClientError('MCP server returned no listTools response', 'LIST_TOOLS_FAILED');
      return response.tools.map((t) => ({
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        // The SDK returns a JSON Schema-compatible object; trust the type
        // for now. Validation against MCP's schema dialect lands in v0.7.
        inputSchema: (t.inputSchema ?? {
          type: 'object',
          properties: {},
        }) as McpToolDefinition['inputSchema'],
      }));
    } catch (err) {
      if (err instanceof McpClientError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new McpClientError(`Failed to list tools: ${message}`, 'LIST_TOOLS_FAILED');
    }
  }

  /**
   * Call a tool on the server. Returns the text content (concatenated
   * if multiple content blocks), the structured content (if any),
   * and the isError flag.
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
    this.assertConnected();
    try {
      const response = await this.sdkClient?.callTool({ name, arguments: args });
      if (!response)
        throw new McpClientError('Not connected. Call connect() first.', 'NOT_CONNECTED');
      const text = response.content
        .filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text)
        .join('\n');
      return {
        ...(text ? { text } : {}),
        ...(response.structuredContent !== undefined
          ? { structured: response.structuredContent }
          : {}),
        ...(response.isError ? { isError: true } : {}),
      };
    } catch (err) {
      if (err instanceof McpClientError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new McpClientError(`Failed to call tool '${name}': ${message}`, 'CALL_TOOL_FAILED');
    }
  }

  /**
   * Disconnect from the server and release resources. Idempotent —
   * calling on a disconnected client is a no-op.
   */
  async disconnect(): Promise<void> {
    if (!this.connected || !this.sdkClient) {
      this.connected = false;
      return;
    }
    try {
      await this.sdkClient.close();
    } catch {
      // Best-effort. The connection is gone from our perspective
      // regardless of what the SDK reports.
    } finally {
      this.sdkClient = undefined;
      this.connected = false;
    }
  }

  // ── Internals ───────────────────────────────────────────────

  private assertConnected(): void {
    if (!this.connected || !this.sdkClient) {
      throw new McpClientError('Not connected. Call connect() first.', 'NOT_CONNECTED');
    }
  }

  private buildTransport(sdk: SdkCache): McpSdkTransport {
    if (this.config.transport === 'stdio') {
      return new sdk.StdioClientTransport({
        command: this.config.command,
        ...(this.config.args ? { args: [...this.config.args] } : {}),
        ...(this.config.env ? { env: { ...this.config.env } } : {}),
      });
    }
    return new sdk.StreamableHTTPClientTransport(new URL(this.config.url), {
      ...(this.config.headers ? { requestInit: { headers: { ...this.config.headers } } } : {}),
    });
  }

  private configLabel(): string {
    if (this.config.transport === 'stdio') {
      return `stdio: ${this.config.command} ${(this.config.args ?? []).join(' ')}`.trim();
    }
    return `http: ${this.config.url}`;
  }
}
