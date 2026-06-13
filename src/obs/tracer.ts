/**
 * Husk — observability types (tracer interface).
 *
 * A minimal, OTel-inspired tracer interface. Husk's events are mapped
 * to spans by the mapper in ./tracer.ts. Users can plug in the real
 * @opentelemetry/api tracer via the adapter (see ./otel-adapter.ts)
 * or any other compatible backend.
 *
 * Design choice: we don't depend on @opentelemetry/api directly. The
 * interface here is a strict subset of OTel's Span interface (just
 * what's needed for agent observability). Keeping the dep out of
 * Husk's core means users who don't need OTel pay nothing for it.
 *
 * For users who want full OTel:
 *   import { trace } from '@opentelemetry/api';
 *   import { toOtelTracer } from '@princetheprogrammerbtw/husk/otel-adapter';
 *   agent.onAny(toOtelTracer(trace.getTracer('husk')).onEvent);
 */

// ───────────────────────────────────────────────────────────────────
// Span — a unit of work (e.g., one agent run, one tool call)
// ───────────────────────────────────────────────────────────────────

export type SpanKind = 'internal' | 'client' | 'server';

export interface SpanContext {
  /** Unique trace id (all spans in one agent.run share this). */
  readonly traceId: string;
  /** Unique span id. */
  readonly spanId: string;
  /** Parent span id, if any. */
  readonly parentSpanId?: string;
}

export interface SpanOptions {
  readonly name: string;
  readonly kind?: SpanKind;
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly startTimeNs?: bigint;
}

export interface Span {
  readonly context: SpanContext;
  /** Record an event (timestamped annotation) on the span. */
  addEvent(name: string, attributes?: Record<string, unknown>): void;
  /** Set or update an attribute on the span. */
  setAttribute(key: string, value: string | number | boolean | null): void;
  /** Record an exception. */
  recordException(err: Error): void;
  /** Mark the span as failed. */
  setStatus(status: 'ok' | 'error', message?: string): void;
  /** End the span. Must be called exactly once. */
  end(endTimeNs?: bigint): void;
}

// ───────────────────────────────────────────────────────────────────
// Tracer — creates spans
// ───────────────────────────────────────────────────────────────────

export interface Tracer {
  /**
   * Start a new span. If parent is provided, the new span becomes a
   * child of it. Returns the new span; caller is responsible for
   * calling .end() on it.
   */
  startSpan(options: SpanOptions, parent?: SpanContext): Span;
}

// ───────────────────────────────────────────────────────────────────
// No-op tracer (default)
// ───────────────────────────────────────────────────────────────────

/**
 * A tracer that does nothing. Used when no real tracer is configured.
 * Zero overhead — every method is a no-op, so the cost is one virtual
 * call per event.
 */
export class NoopTracer implements Tracer {
  startSpan(_options: SpanOptions, _parent?: SpanContext): Span {
    const ctx: SpanContext = {
      traceId: '0',
      spanId: '0',
    };
    return {
      context: ctx,
      addEvent: () => {},
      setAttribute: () => {},
      recordException: () => {},
      setStatus: () => {},
      end: () => {},
    };
  }
}
