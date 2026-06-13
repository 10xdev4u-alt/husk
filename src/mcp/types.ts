/**
 * Husk — MCP types.
 *
 * Pure type definitions, no runtime code. The runtime lives in
 * client.ts and define-mcp-tools.ts. Splitting them keeps the
 * type-only file cheap to import.
 */

import type { JSONSchema } from '../core/types.js';

/** Common config for any MCP client. */
export interface McpClientConfigBase {
  /** Display name for logging. */
  readonly name?: string;
  /** Connection timeout in ms. Default: 30000. */
  readonly timeoutMs?: number;
}

/** Stdio transport — spawn a child process and speak JSON-RPC over its stdio. */
export interface McpStdioConfig extends McpClientConfigBase {
  readonly transport: 'stdio';
  /** Command to spawn (e.g. 'npx', 'node', '/usr/local/bin/my-mcp'). */
  readonly command: string;
  /** Arguments to the command. */
  readonly args?: readonly string[];
  /** Environment variables for the child process. */
  readonly env?: Readonly<Record<string, string>>;
}

/** HTTP transport — speak JSON-RPC over Streamable HTTP. */
export interface McpHttpConfig extends McpClientConfigBase {
  readonly transport: 'http';
  /** URL of the MCP server (Streamable HTTP endpoint). */
  readonly url: string;
  /** Optional headers (e.g. for auth). */
  readonly headers?: Readonly<Record<string, string>>;
}

/** Discriminated union of supported transports. */
export type McpClientConfig = McpStdioConfig | McpHttpConfig;

/** A tool discovered from an MCP server, before Husk wrapping. */
export interface McpToolDefinition {
  /** Tool name (from MCP server). */
  readonly name: string;
  /** Human-readable description. */
  readonly description?: string;
  /** JSON Schema for the tool's input. */
  readonly inputSchema: JSONSchema;
}

/** Result of calling a tool on an MCP server. */
export interface McpToolResult {
  /** Concatenated text content (if any). */
  readonly text?: string;
  /** Structured content (if the tool returned a JSON object). */
  readonly structured?: unknown;
  /** Whether the tool reported an error. */
  readonly isError?: boolean;
}

/** Strongly-typed input shape for an MCP-wrapped Husk tool. */
export type McpToolInput = Record<string, unknown>;

/**
 * Configuration for `defineMcpServer()`. Wraps a Husk tool set
 * as an MCP server so any MCP-compatible client (Claude Desktop,
 * custom agents, etc.) can call those tools.
 */
export interface McpServerConfig {
  /** Display name for the server. Sent to the client during handshake. */
  readonly name: string;
  /** Version string. Same usage as `name`. */
  readonly version: string;
  /** Husk tools to expose. */
  readonly tools: readonly import('../core/types.js').ToolDefinition[];
  /**
   * If true, include tools that have `requireApproval: true`.
   * Default: false (excluded). Exposing an approval-gated tool
   * over MCP is a security hole — the MCP client has no way to
   * surface the approval prompt. Override only if your MCP
   * client handles approval natively.
   */
  readonly includeApprovalGated?: boolean;
}

/**
 * The handle returned by `defineMcpServer()`. Wraps the
 * underlying SDK server with a Husk-friendly surface.
 */
export interface McpServerHandle {
  /**
   * The raw SDK McpServer. Exposed for advanced cases (custom
   * transports, programmatic inspection). Prefer `.connect()`
   * for the common case.
   */
  readonly raw: unknown;
  /** Connect the server to a transport (stdio, HTTP, etc.). */
  connect(transport: unknown): Promise<void>;
  /** Close the server. Idempotent. */
  close(): Promise<void>;
}
