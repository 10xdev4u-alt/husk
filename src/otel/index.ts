/**
 * Husk — OpenTelemetry adapter.
 *
 * Bridges Husk's minimal Tracer interface to the real
 * @opentelemetry/api Tracer. Users who want production observability
 * install @opentelemetry/api alongside Husk, then use this adapter
 * to convert their OTel tracer into a Husk Tracer for use with
 * EventTracer.
 *
 * Subpath import: '@princetheprogrammerbtw/husk/otel'
 *
 * @opentelemetry/api is declared as an *optional peer* dependency.
 * If you try to use this subpath without installing OTel, you'll
 * get a clear import error.
 *
 * Usage:
 *
 *   // 1. Set up OTel (your existing code)
 *   import { trace } from '@opentelemetry/api';
 *   const otelTracer = trace.getTracer('my-app', '1.0.0');
 *
 *   // 2. Bridge to Husk
 *   import { EventTracer } from '@princetheprogrammerbtw/husk';
 *   import { OtelTracerAdapter } from '@princetheprogrammerbtw/husk/otel';
 *   const huskTracer = new OtelTracerAdapter(otelTracer);
 *
 *   // 3. Wire up the agent
 *   const agent = new Agent({ model: ... });
 *   agent.onAny(new EventTracer(huskTracer).onEvent);
 *
 *   // 4. Configure your OTel exporter as usual (OTLP, Jaeger, etc.)
 *   // Husk's events now show up as spans in your backend.
 */

import type { Span as OtelSpan, Tracer as OtelTracer } from '@opentelemetry/api';
import type {
  Span as HuskSpan,
  SpanContext,
  SpanKind,
  SpanOptions,
  Tracer,
} from '../obs/tracer.js';

export interface OtelTracerAdapterOptions {
  /** Optional attribute transformer. Default: pass through. */
  readonly transformAttribute?: (
    key: string,
    value: string | number | boolean | null,
  ) => string | number | boolean;
}

export class OtelTracerAdapter implements Tracer {
  private readonly otel: OtelTracer;
  private readonly options: OtelTracerAdapterOptions;

  constructor(otel: OtelTracer, options: OtelTracerAdapterOptions = {}) {
    this.otel = otel;
    this.options = options;
  }

  startSpan(options: SpanOptions, _parent?: SpanContext): HuskSpan {
    const otelSpan = this.otel.startSpan(options.name, {
      kind: mapKind(options.kind),
      attributes: stringifyAttrs(options.attributes),
    });
    return new OtelSpanAdapter(otelSpan, this.options);
  }
}

// ───────────────────────────────────────────────────────────────────
// Span adapter
// ───────────────────────────────────────────────────────────────────

class OtelSpanAdapter implements HuskSpan {
  readonly context: SpanContext;
  private readonly otel: OtelSpan;

  constructor(otel: OtelSpan, _options: OtelTracerAdapterOptions) {
    this.otel = otel;
    const ctx = otel.spanContext();
    this.context = {
      traceId: ctx.traceId,
      spanId: ctx.spanId,
    };
  }

  addEvent(name: string, attributes?: Record<string, unknown>): void {
    this.otel.addEvent(name, stringifyAttrs(attributes));
  }

  setAttribute(key: string, value: string | number | boolean | null): void {
    // OTel attributes can't be null; encode as empty string.
    this.otel.setAttribute(key, value === null ? '' : value);
  }

  recordException(err: Error): void {
    this.otel.recordException(err);
  }

  setStatus(status: 'ok' | 'error', message?: string): void {
    if (status === 'ok') {
      this.otel.setStatus({ code: 1 }); // OTel SpanStatusCode.OK
    } else {
      this.otel.setStatus({ code: 2, message: message ?? 'error' }); // OTel SpanStatusCode.ERROR
    }
  }

  end(_endTimeNs?: bigint): void {
    this.otel.end();
  }
}

// ───────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────

function mapKind(kind: SpanKind | undefined): 0 | 1 | 2 {
  // OTel SpanKind: 0=INTERNAL, 1=SERVER, 2=CLIENT
  switch (kind) {
    case 'client':
      return 2;
    case 'server':
      return 1;
    default:
      return 0;
  }
}

function stringifyAttrs(
  attrs: Readonly<Record<string, unknown>> | undefined,
): Record<string, string | number | boolean> {
  if (!attrs) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    } else {
      out[k] = JSON.stringify(v);
    }
  }
  return out;
}
