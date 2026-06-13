/**
 * Husk — observability tracer tests.
 *
 * Verifies the EventTracer correctly maps AgentEvents to spans, and
 * that the NoopTracer is a true no-op (no exceptions, no allocations).
 *
 * Uses a fake Tracer that records every method call, so we can
 * assert on the span lifecycle without standing up a real backend.
 */

import { describe, expect, test } from 'bun:test';
import type { AgentEvent } from '../src/core/events.js';
import { EventTracer, NoopTracer, type Span, type SpanOptions, type Tracer } from '../src/index.js';

// ───────────────────────────────────────────────────────────────────
// Fake Tracer
// ───────────────────────────────────────────────────────────────────

interface RecordedCall {
  method: 'startSpan' | 'addEvent' | 'setAttribute' | 'recordException' | 'setStatus' | 'end';
  args: unknown[];
  spanId: string;
}

function makeFakeTracer(): { tracer: Tracer; calls: RecordedCall[]; spans: Span[] } {
  const calls: RecordedCall[] = [];
  const spans: Span[] = [];
  let nextId = 0;
  const spanMap = new Map<string, Span>();

  const recordCall = (span: Span, method: RecordedCall['method'], args: unknown[]) => {
    calls.push({ method, args, spanId: span.context.spanId });
  };

  const makeSpan = (options: SpanOptions): Span => {
    const id = String(nextId++);
    const ctx = { traceId: 'trace-1', spanId: id };
    const span: Span = {
      context: ctx,
      addEvent: (name, attrs) => recordCall(span, 'addEvent', [name, attrs]),
      setAttribute: (key, value) => recordCall(span, 'setAttribute', [key, value]),
      recordException: (err) => recordCall(span, 'recordException', [err]),
      setStatus: (status, msg) => recordCall(span, 'setStatus', [status, msg]),
      end: () => recordCall(span, 'end', []),
    };
    spanMap.set(id, span);
    spans.push(span);
    return span;
  };

  const tracer: Tracer = {
    startSpan: (options) => {
      const span = makeSpan(options);
      calls.push({ method: 'startSpan', args: [options], spanId: span.context.spanId });
      return span;
    },
  };
  return { tracer, calls, spans };
}

// ───────────────────────────────────────────────────────────────────
// NoopTracer
// ───────────────────────────────────────────────────────────────────

describe('NoopTracer', () => {
  test('startSpan returns a span', () => {
    const t = new NoopTracer();
    const span = t.startSpan({ name: 'test' });
    expect(span.context.traceId).toBe('0');
    expect(span.context.spanId).toBe('0');
  });

  test('all span methods are callable without effect', () => {
    const t = new NoopTracer();
    const span = t.startSpan({ name: 'test' });
    expect(() => {
      span.addEvent('e');
      span.setAttribute('k', 'v');
      span.recordException(new Error('x'));
      span.setStatus('ok');
      span.end();
    }).not.toThrow();
  });
});

// ───────────────────────────────────────────────────────────────────
// EventTracer
// ───────────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  // Yield so any pending microtasks run.
  await Promise.resolve();
}

async function emit(events: AgentEvent[], mapper: EventTracer): Promise<void> {
  for (const e of events) {
    await mapper.onEvent(e);
    await tick();
  }
}

describe('EventTracer', () => {
  test('agent:start begins a trace span', async () => {
    const { tracer, calls } = makeFakeTracer();
    const mapper = new EventTracer(tracer);
    await emit([{ type: 'agent:start', input: 'hi', sessionId: 's1' }], mapper);
    expect(
      calls.some(
        (c) => c.method === 'startSpan' && (c.args[0] as SpanOptions).name === 'agent.run',
      ),
    ).toBe(true);
  });

  test('agent:end closes the trace span', async () => {
    const { tracer, calls, spans } = makeFakeTracer();
    const mapper = new EventTracer(tracer);
    await emit(
      [
        { type: 'agent:start', input: 'hi', sessionId: 's1' },
        { type: 'agent:end', output: 'bye', iterations: 1, durationMs: 100 },
      ],
      mapper,
    );
    const traceSpan = spans[0];
    if (!traceSpan) throw new Error('no trace span');
    const endCalls = calls.filter(
      (c) => c.method === 'end' && c.spanId === traceSpan.context.spanId,
    );
    expect(endCalls.length).toBe(1);
  });

  test('tool call and result nest correctly', async () => {
    const { tracer, spans } = makeFakeTracer();
    const mapper = new EventTracer(tracer);
    await emit(
      [
        { type: 'agent:start', input: 'x', sessionId: 's' },
        { type: 'agent:iteration', iteration: 1 },
        { type: 'tool:call', id: 'tc-1', name: 'Read', input: { path: 'a.txt' } },
        {
          type: 'tool:result',
          id: 'tc-1',
          name: 'Read',
          result: { output: 'file contents' },
          durationMs: 5,
        },
      ],
      mapper,
    );
    // We expect at least 3 spans: agent.run, iteration.1, tool.Read
    expect(spans.length).toBeGreaterThanOrEqual(3);
    const toolSpan = spans.find((s) => s.context.spanId === '2');
    expect(toolSpan).toBeDefined();
  });

  test('agent:error records the exception and ends the trace', async () => {
    const { tracer, calls, spans } = makeFakeTracer();
    const mapper = new EventTracer(tracer);
    const err = new Error('boom');
    await emit(
      [
        { type: 'agent:start', input: 'x', sessionId: 's' },
        { type: 'agent:error', error: err },
      ],
      mapper,
    );
    const traceSpan = spans[0];
    if (!traceSpan) throw new Error('no trace span');
    const recordExceptionCalls = calls.filter(
      (c) => c.method === 'recordException' && c.spanId === traceSpan.context.spanId,
    );
    const setStatusError = calls.filter(
      (c) =>
        c.method === 'setStatus' &&
        c.spanId === traceSpan.context.spanId &&
        (c.args[0] as string) === 'error',
    );
    expect(recordExceptionCalls.length).toBe(1);
    expect(setStatusError.length).toBe(1);
  });
});
