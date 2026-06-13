/**
 * Husk — MCP client error class.
 *
 * Carries a machine-readable `code` so callers can branch on the
 * kind of failure (SDK missing vs connect failed vs tool call
 * failed) without parsing the error message.
 */

export type McpClientErrorCode =
  | 'SDK_MISSING'
  | 'SDK_LOAD_FAILED'
  | 'ALREADY_CONNECTED'
  | 'NOT_CONNECTED'
  | 'CONNECT_FAILED'
  | 'LIST_TOOLS_FAILED'
  | 'CALL_TOOL_FAILED';

export class McpClientError extends Error {
  override readonly name = 'McpClientError';
  readonly code: McpClientErrorCode;
  constructor(message: string, code: McpClientErrorCode) {
    super(message);
    this.code = code;
  }
}
