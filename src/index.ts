/**
 * Husk — public API entry point.
 *
 * Single import surface for users:
 *   import { Agent, Anthropic, OpenAI, Read, Write, Bash, Edit, Grep,
 *           InMemoryStore, FileStore, ConsoleLogger } from '@princetheprogrammerbtw/husk';
 *
 * Re-exports are added incrementally as features land (see commit history).
 */

export const VERSION = '0.1.0';

// Core types
export type {
  Role,
  Message,
  MessageContent,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  JSONSchema,
  JSONSchemaField,
  ToolDefinition,
  ToolContext,
  ToolResult,
  Provider,
  ChatRequest,
  ChatResponse,
  ChatChunk,
  TokenUsage,
  StopReason,
  MemoryStore,
  SteeringConfig,
  Example,
  AgentConfig,
  AgentResult,
  LogLevel,
  Logger,
} from './core/types.js';

// Events
export {
  AgentEventEmitter,
  ConsoleLogger,
  logEventsTo,
  type AgentEvent,
  type AgentEventHandler,
} from './core/events.js';

// Memory
export { InMemoryStore, FileStore, type FileStoreOptions } from './core/memory.js';

// Steering helpers
export { buildSystemPrompt, buildExampleMessages } from './core/steering.js';

// Agent
export { Agent } from './core/agent.js';

// Providers
export { AnthropicProvider, type AnthropicProviderOptions } from './providers/anthropic.js';
export { OpenAIProvider, type OpenAIProviderOptions } from './providers/openai.js';
export { OllamaProvider, type OllamaProviderOptions } from './providers/ollama.js';

// Tool helpers
export {
  defineTool,
  objectSchema,
  stringField,
  numberField,
  integerField,
  booleanField,
  arrayField,
  objectField,
} from './tools/registry.js';

// Built-in tools
export {
  Read,
  Write,
  Edit,
  Bash,
  Grep,
  type ReadInput,
  type WriteInput,
  type EditInput,
  type BashInput,
  type GrepInput,
} from './tools/builtin/index.js';

// Evals
export {
  equals,
  contains,
  notContains,
  matches,
  fn,
  lengthBetween,
  defineSuite,
  runSuite,
  type Assertion,
  type AssertionResult,
  type EvalCase,
  type EvalSuite,
  type CaseResult,
  type SuiteResult,
  type AgentFactory,
  type RunSuiteOptions,
} from './evals/index.js';

// Observability
export {
  NoopTracer,
  EventTracer,
  type Tracer,
  type Span,
  type SpanContext,
  type SpanKind,
  type SpanOptions,
} from './obs/index.js';
