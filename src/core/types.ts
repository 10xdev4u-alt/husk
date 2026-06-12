/**
 * Husk — core type definitions.
 *
 * This file is the foundation of the public API. Every other module
 * (agent loop, providers, tools, memory, steering) depends on the
 * types defined here. Treat changes to this file as breaking changes
 * unless the change is purely additive (a new optional field).
 *
 * Design principle: model the LARGEST common subset of provider
 * APIs (Anthropic + OpenAI), then let provider adapters translate
 * provider-specific formats into these shapes.
 */

// ───────────────────────────────────────────────────────────────────
// Messages — the unit of conversation between user, assistant, and tools
// ───────────────────────────────────────────────────────────────────

/** Roles a message can take. `tool` is used for tool execution results. */
export type Role = 'system' | 'user' | 'assistant' | 'tool';

/**
 * The content of a message. Most simple messages are plain strings.
 * Messages that involve tool use or tool results are arrays of blocks.
 *
 * String content is the common case (user prompts, simple replies).
 * Block content is used when the message contains tool calls (from the
 * assistant) or tool results (in response to a tool call).
 */
export type MessageContent = string | ContentBlock[];

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface TextBlock {
  readonly type: 'text';
  readonly text: string;
}

/** A request from the assistant to invoke a tool. */
export interface ToolUseBlock {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

/** The result of a tool invocation, fed back to the assistant. */
export interface ToolResultBlock {
  readonly type: 'tool_result';
  readonly toolUseId: string;
  readonly content: string | ContentBlock[];
  readonly isError?: boolean;
}

export interface Message {
  readonly role: Role;
  readonly content: MessageContent;
  /** Used for `tool` role messages to identify which tool produced the result. */
  readonly name?: string;
  /** Used for `tool` role messages to link back to the originating ToolUseBlock. */
  readonly toolCallId?: string;
}

// ───────────────────────────────────────────────────────────────────
// JSON Schema — subset we accept from tool definitions
// ───────────────────────────────────────────────────────────────────

/**
 * A minimal JSON Schema type. We don't try to model the full spec —
 * just the shape that tools actually need: object with properties,
 * required fields, descriptions. Provider adapters can downcast to
 * their own schema types.
 */
export interface JSONSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, JSONSchemaField>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

export interface JSONSchemaField {
  readonly type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null';
  readonly description?: string;
  readonly enum?: readonly unknown[];
  readonly items?: JSONSchemaField;
  readonly properties?: Readonly<Record<string, JSONSchemaField>>;
  readonly required?: readonly string[];
}

// ───────────────────────────────────────────────────────────────────
// Tools — what the agent can do
// ───────────────────────────────────────────────────────────────────

export interface ToolContext {
  /** Abort signal to support cancellation. */
  readonly signal?: AbortSignal;
  /** Structured logger the tool can use. */
  readonly logger?: Logger;
}

/**
 * The result of running a tool. `output` is what the LLM sees.
 * `isError` distinguishes a successful "no results found" from
 * an actual exception.
 */
export interface ToolResult {
  readonly output: string;
  readonly isError?: boolean;
}

/**
 * A tool the agent can invoke. Providers translate this to their
 * native tool format (Anthropic's `tools` array, OpenAI's
 * `functions` array, etc.).
 */
export interface ToolDefinition<TInput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JSONSchema;
  readonly execute: (input: TInput, ctx: ToolContext) => Promise<ToolResult>;
}

// ───────────────────────────────────────────────────────────────────
// Providers — model adapters
// ───────────────────────────────────────────────────────────────────

/** Why the model stopped generating. */
export type StopReason =
  | 'end_turn' // natural end of response
  | 'tool_use' // model wants to call one or more tools
  | 'max_tokens' // hit the output token limit
  | 'stop_sequence' // hit a custom stop sequence
  | 'error'; // something went wrong

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ChatRequest {
  readonly model: string;
  readonly messages: readonly Message[];
  readonly tools?: readonly ToolDefinition[];
  readonly system?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly stopSequences?: readonly string[];
}

export interface ChatResponse {
  readonly message: Message;
  readonly usage: TokenUsage;
  readonly stopReason: StopReason;
  readonly model: string;
}

export interface ChatChunk {
  readonly type: 'text' | 'tool_use_start' | 'tool_use_delta' | 'message_end';
  readonly text?: string;
  readonly toolUse?: { id: string; name: string; inputDelta?: string };
  readonly usage?: TokenUsage;
  readonly stopReason?: StopReason;
}

/**
 * A model provider. Implementations translate the provider-agnostic
 * `ChatRequest` to the provider's wire format and back.
 *
 * `name` is the provider family ("anthropic", "openai", "ollama").
 * `model` is the specific model id the provider is configured for
 * (e.g. "claude-opus-4-6"). The agent loop reads `model` when building
 * requests, so providers should be configured with a model at
 * construction time.
 */
export interface Provider {
  readonly name: string;
  readonly model: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream?(request: ChatRequest): AsyncIterable<ChatChunk>;
}

// ───────────────────────────────────────────────────────────────────
// Memory — cross-call and cross-session state
// ───────────────────────────────────────────────────────────────────

/**
 * A memory store. Two backends ship in v0.1.0:
 * - InMemoryStore: session-scoped, lost on process exit
 * - FileStore: persistent, JSONL on disk
 */
export interface MemoryStore {
  /** Load all messages for a session, in order. */
  read(sessionId: string): Promise<readonly Message[]>;
  /** Append a message to a session. */
  append(sessionId: string, message: Message): Promise<void>;
  /** Clear all messages for a session. */
  clear(sessionId: string): Promise<void>;
  /** List all session IDs the store knows about. */
  listSessions(): Promise<readonly string[]>;
}

// ───────────────────────────────────────────────────────────────────
// Steering — rules and examples that shape agent behavior
// ───────────────────────────────────────────────────────────────────

export interface Example {
  readonly user: string;
  readonly assistant: string;
}

export interface SteeringConfig {
  /** A system prompt prepended to every conversation. */
  readonly systemPrompt?: string;
  /** Behavioral rules injected into the system prompt as a numbered list. */
  readonly rules?: readonly string[];
  /** Few-shot examples prepended to the conversation as user/assistant pairs. */
  readonly examples?: readonly Example[];
}

// ───────────────────────────────────────────────────────────────────
// Agent — the main harness
// ───────────────────────────────────────────────────────────────────

export interface AgentConfig {
  readonly model: Provider;
  readonly tools?: readonly ToolDefinition[];
  readonly memory?: MemoryStore;
  readonly steering?: SteeringConfig;
  /** Hard cap on agent loop iterations. Default: 25. */
  readonly maxIterations?: number;
  /** Sampling temperature. Default: 0 (deterministic). */
  readonly temperature?: number;
  /** Max output tokens per model call. Provider-specific defaults apply. */
  readonly maxTokens?: number;
  /** Abort signal for cancellation. */
  readonly signal?: AbortSignal;
  /** Session ID for memory continuity. Default: 'default'. */
  readonly sessionId?: string;
}

export interface AgentResult {
  readonly output: string;
  readonly messages: readonly Message[];
  readonly iterations: number;
  readonly usage: TokenUsage;
  readonly durationMs: number;
}

// ───────────────────────────────────────────────────────────────────
// Logger — minimal structured logging interface
// ───────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}
