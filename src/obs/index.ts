/**
 * Husk — observability module barrel.
 *
 * Public surface for tracing:
 *   import { EventTracer, NoopTracer, type Tracer, type Span } from '@princetheprogrammerbtw/husk';
 *
 * Pair with the OTel adapter (subpath import) to plug into
 * @opentelemetry/api:
 *   import { trace } from '@opentelemetry/api';
 *   import { OtelTracerAdapter } from '@princetheprogrammerbtw/husk/otel';
 */

export {
  NoopTracer,
  type Tracer,
  type Span,
  type SpanContext,
  type SpanKind,
  type SpanOptions,
} from './tracer.js';
export { EventTracer } from './mapper.js';
