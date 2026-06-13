/**
 * Husk — agent event → tracer mapper.
 *
 * Translates the typed AgentEvent stream into tracer spans. The top-
 * level 'agent:start' begins a trace, each iteration becomes a child
 * span, and tool calls become their own spans under the iteration.
 *
 * Design: spans are created in startSpanOrder. Tool spans nest under
 * the iteration span. The end of the agent run ends the trace span.
 *
 * Usage:
 *   const mapper = new EventTracer(myTracer);
 *   agent.onAny(mapper.onEvent.bind(mapper));
 *   await agent.run(...);  // emits spans to myTracer
 */

import type { AgentEventHandler } from '../core/events.js';
import type { Span, Tracer } from './tracer.js';

// ───────────────────────────────────────────────────────────────────
// EventTracer
// ───────────────────────────────────────────────────────────────────

export class EventTracer {
  private readonly tracer: Tracer;
  private traceSpan: Span | null = null;
  private iterationSpan: Span | null = null;
  private toolSpans: Map<string, Span> = new Map();

  constructor(tracer: Tracer) {
    this.tracer = tracer;
  }

  /**
   * Bind as an event handler: `agent.onAny(tracer.onEvent.bind(tracer))`
   */
  onEvent: AgentEventHandler = (event) => {
    switch (event.type) {
      case 'agent:start': {
        this.traceSpan = this.tracer.startSpan({
          name: `agent.run`,
          kind: 'internal',
          attributes: {
            'husk.input': event.input,
            'husk.session_id': event.sessionId,
          },
        });
        break;
      }

      case 'agent:iteration': {
        // Close any stale iteration span (defensive — shouldn't happen
        // because the loop is synchronous, but guards against future
        // async refactors).
        this.iterationSpan?.end();
        this.iterationSpan = this.tracer.startSpan(
          {
            name: `iteration.${event.iteration}`,
            kind: 'internal',
            attributes: { 'husk.iteration': event.iteration },
          },
          this.traceSpan?.context,
        );
        break;
      }

      case 'provider:request': {
        this.iterationSpan?.addEvent('provider.request', {
          'provider.model': event.request.model,
        });
        break;
      }

      case 'provider:response': {
        if (this.iterationSpan) {
          this.iterationSpan.setAttribute(
            'provider.input_tokens',
            event.response.usage.inputTokens,
          );
          this.iterationSpan.setAttribute(
            'provider.output_tokens',
            event.response.usage.outputTokens,
          );
          this.iterationSpan.setAttribute('provider.stop_reason', event.response.stopReason);
          this.iterationSpan.setAttribute('provider.duration_ms', event.durationMs);
        }
        break;
      }

      case 'tool:call': {
        const span = this.tracer.startSpan(
          {
            name: `tool.${event.name}`,
            kind: 'internal',
            attributes: {
              'tool.name': event.name,
              'tool.input': JSON.stringify(event.input),
            },
          },
          this.iterationSpan?.context ?? this.traceSpan?.context,
        );
        this.toolSpans.set(event.id, span);
        break;
      }

      case 'tool:result': {
        const span = this.toolSpans.get(event.id);
        if (span) {
          span.setAttribute('tool.is_error', event.result.isError ?? false);
          span.setAttribute('tool.duration_ms', event.durationMs);
          if (event.result.isError) {
            span.setStatus('error', event.result.output);
          } else {
            span.setStatus('ok');
          }
          span.end();
          this.toolSpans.delete(event.id);
        }
        break;
      }

      case 'agent:end': {
        this.iterationSpan?.end();
        this.iterationSpan = null;
        if (this.traceSpan) {
          this.traceSpan.setAttribute('husk.iterations', event.iterations);
          this.traceSpan.setAttribute('husk.duration_ms', event.durationMs);
          this.traceSpan.setStatus('ok');
          this.traceSpan.end();
          this.traceSpan = null;
        }
        break;
      }

      case 'agent:error': {
        if (this.traceSpan) {
          this.traceSpan.recordException(event.error);
          this.traceSpan.setStatus('error', event.error.message);
          this.traceSpan.end();
          this.traceSpan = null;
        }
        this.iterationSpan?.end();
        this.iterationSpan = null;
        // End any in-flight tool spans so they don't leak.
        for (const span of this.toolSpans.values()) {
          span.end();
        }
        this.toolSpans.clear();
        break;
      }

      case 'agent:message': {
        this.iterationSpan?.addEvent('message', {
          'message.role': event.message.role,
        });
        break;
      }
    }
  };
}

// Re-export SpanContext for users who want to write their own mappers.
export type { Span, SpanContext, Tracer } from './tracer.js';
