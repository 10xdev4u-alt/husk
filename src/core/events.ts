/**
 * Husk — typed event emitter for observability.
 *
 * Every interesting thing that happens inside the agent loop fires
 * an event. Downstream consumers (loggers, tracers, dashboards, test
 * assertions) subscribe to these events to observe behavior without
 * having to monkey-patch the agent.
 *
 * Design choice: a discriminated-union event type instead of a generic
 * EventEmitter. The compiler can verify that handlers receive the right
 * payload shape, and tooling can autocomplete event names.
 */

import type { ChatRequest, ChatResponse, Logger, Message, ToolResult } from './types.js';
export type { Logger };

// ───────────────────────────────────────────────────────────────────
// Event union
// ───────────────────────────────────────────────────────────────────

export type AgentEvent =
  | { readonly type: 'agent:start'; readonly input: string; readonly sessionId: string }
  | { readonly type: 'agent:iteration'; readonly iteration: number }
  | { readonly type: 'agent:message'; readonly message: Message }
  | { readonly type: 'provider:request'; readonly request: ChatRequest }
  | {
      readonly type: 'provider:response';
      readonly response: ChatResponse;
      readonly durationMs: number;
    }
  | {
      readonly type: 'tool:call';
      readonly id: string;
      readonly name: string;
      readonly input: unknown;
    }
  | {
      readonly type: 'tool:result';
      readonly id: string;
      readonly name: string;
      readonly result: ToolResult;
      readonly durationMs: number;
    }
  | {
      readonly type: 'agent:end';
      readonly output: string;
      readonly iterations: number;
      readonly durationMs: number;
    }
  | { readonly type: 'agent:error'; readonly error: Error };

/** A handler for a specific event type. */
export type AgentEventHandler<E extends AgentEvent = AgentEvent> = (
  event: E,
) => void | Promise<void>;

// ───────────────────────────────────────────────────────────────────
// EventEmitter
// ───────────────────────────────────────────────────────────────────

/**
 * A minimal, type-safe event bus. We could use Node's EventEmitter,
 * but the untyped `on('event', handler)` API loses the discriminated-
 * union narrowing we get from per-type handlers.
 */
export class AgentEventEmitter {
  private readonly handlers: Map<AgentEvent['type'], AgentEventHandler[]> = new Map();
  private readonly wildcardHandlers: AgentEventHandler[] = [];

  /**
   * Subscribe to a specific event type. The handler receives only
   * events of that type with the correct payload shape.
   */
  on<E extends AgentEvent['type']>(
    type: E,
    handler: AgentEventHandler<Extract<AgentEvent, { type: E }>>,
  ): () => void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler as AgentEventHandler);
    this.handlers.set(type, list);
    return () => this.off(type, handler);
  }

  /**
   * Subscribe to all events. Useful for loggers and tracers.
   */
  onAny(handler: AgentEventHandler): () => void {
    this.wildcardHandlers.push(handler);
    return () => {
      const idx = this.wildcardHandlers.indexOf(handler);
      if (idx >= 0) this.wildcardHandlers.splice(idx, 1);
    };
  }

  off<E extends AgentEvent['type']>(
    type: E,
    handler: AgentEventHandler<Extract<AgentEvent, { type: E }>>,
  ): void {
    const list = this.handlers.get(type);
    if (!list) return;
    const idx = list.indexOf(handler as AgentEventHandler);
    if (idx >= 0) list.splice(idx, 1);
  }

  /**
   * Emit an event. Handlers are awaited sequentially; an async handler
   * that throws is logged but doesn't stop subsequent handlers.
   */
  async emit(event: AgentEvent): Promise<void> {
    const typed = this.handlers.get(event.type) ?? [];
    for (const handler of typed) {
      try {
        await handler(event);
      } catch (err) {
        // Last-resort safety: a faulty subscriber must not crash the agent.
        // Production code should also pass a logger here; for v0.1.0 we
        // fall back to console.error.
        // eslint-disable-next-line no-console
        console.error('[husk] event handler threw:', err);
      }
    }
    for (const handler of this.wildcardHandlers) {
      try {
        await handler(event);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[husk] wildcard event handler threw:', err);
      }
    }
  }
}

// ───────────────────────────────────────────────────────────────────
// Built-in event loggers
// ───────────────────────────────────────────────────────────────────

/**
 * A simple console-based logger. Useful for development and as a
 * reference implementation for custom loggers.
 */
export class ConsoleLogger implements Logger {
  debug(message: string, fields?: Record<string, unknown>): void {
    // eslint-disable-next-line no-console
    console.debug(this.format('debug', message, fields));
  }
  info(message: string, fields?: Record<string, unknown>): void {
    // eslint-disable-next-line no-console
    console.info(this.format('info', message, fields));
  }
  warn(message: string, fields?: Record<string, unknown>): void {
    // eslint-disable-next-line no-console
    console.warn(this.format('warn', message, fields));
  }
  error(message: string, fields?: Record<string, unknown>): void {
    // eslint-disable-next-line no-console
    console.error(this.format('error', message, fields));
  }

  private format(level: string, message: string, fields?: Record<string, unknown>): string {
    const ts = new Date().toISOString();
    const fieldsStr = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : '';
    return `${ts} [${level}] ${message}${fieldsStr}`;
  }
}

/**
 * Convert an event stream into structured log lines via a Logger.
 * Drop-in for stdout/JSON observability.
 */
export function logEventsTo(logger: Logger): AgentEventHandler {
  return (event) => {
    switch (event.type) {
      case 'agent:start':
        logger.info('agent started', { input: event.input, sessionId: event.sessionId });
        break;
      case 'agent:iteration':
        logger.debug('agent iteration', { iteration: event.iteration });
        break;
      case 'agent:message':
        logger.debug('agent message', { role: event.message.role });
        break;
      case 'provider:request':
        logger.debug('provider request', { model: event.request.model });
        break;
      case 'provider:response':
        logger.info('provider response', {
          model: event.response.model,
          stopReason: event.response.stopReason,
          inputTokens: event.response.usage.inputTokens,
          outputTokens: event.response.usage.outputTokens,
          durationMs: event.durationMs,
        });
        break;
      case 'tool:call':
        logger.info('tool call', { id: event.id, name: event.name, input: event.input });
        break;
      case 'tool:result':
        logger.info('tool result', {
          id: event.id,
          name: event.name,
          isError: event.result.isError ?? false,
          durationMs: event.durationMs,
        });
        break;
      case 'agent:end':
        logger.info('agent ended', {
          iterations: event.iterations,
          durationMs: event.durationMs,
        });
        break;
      case 'agent:error':
        logger.error('agent error', { message: event.error.message });
        break;
    }
  };
}
