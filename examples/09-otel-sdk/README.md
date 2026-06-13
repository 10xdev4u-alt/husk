# Example 09 — Real OpenTelemetry SDK integration

Wires Husk's minimal `Tracer` interface to a real
`@opentelemetry/sdk-node` pipeline that exports spans to the
console (for dev) or to OTLP-compatible backends (Honeycomb,
Jaeger, Tempo, Datadog, etc.) in production.

This is the "real" counterpart to the `/otel` subpath adapter,
which provides the *interface* but doesn't ship the SDK +
exporters (those are heavier and tree-shake poorly).

## Setup

```bash
cd examples/09-otel-sdk
bun add @opentelemetry/sdk-node \
        @opentelemetry/exporter-trace-otlp-http \
        @opentelemetry/auto-instrumentations-node
bun run index.ts
```

Or with the OTLP gRPC exporter, or the Jaeger exporter, or any
other — Husk's adapter works with any OTel-compatible tracer.

## What you'll see

With a real SDK bootstrapped:
- A trace span for the agent run
- Child spans for each provider call + tool call (the EventTracer
  already maps these; the OTel bridge forwards them as actual
  spans with proper parent-child relationships)
- Attributes on each span (model, tool name, token usage, etc.)

In production, swap `ConsoleSpanExporter` for `BatchSpanProcessor`
+ `OTLPTraceExporter` and point it at your backend.

## What this demonstrates

- **`OtelTracerAdapter` is the bridge** — wraps any OTel `Tracer`
  so it implements Husk's `Tracer` interface.
- **`EventTracer` is the mapper** — listens to agent events and
  calls the tracer. Combined with the adapter, you get real
  OTel spans for free.
- **Bootstrap order matters** — call the SDK's `start()` BEFORE
  any Husk code runs, so the SDK has time to wire up its
  auto-instrumentations (HTTP, DNS, etc.).
- **The NoopTracerProvider is the default** if you haven't
  bootstrapped the SDK yet. The adapter still works end-to-end
  and you'll see spans in your console once you install +
  bootstrap the SDK.

## Library usage

```ts
// bootstrap.ts (in your app's entry point)
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'my-husk-agent',
  }),
  traceExporter: new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' }),
  instrumentations: [getNodeAutoInstrumentations()],
});
sdk.start();
```

```ts
// agent.ts
import { trace } from '@opentelemetry/api';
import { Agent, AnthropicProvider, EventTracer } from '@princetheprogrammerbtw/husk';
import { OtelTracerAdapter } from '@princetheprogrammerbtw/husk/otel';

const otelTracer = trace.getTracer('my-app');
const huskTracer = new OtelTracerAdapter(otelTracer);

const agent = new Agent({
  model: new AnthropicProvider(),
  tools: [Read, Write, Edit, Bash, Grep],
  tracer: new EventTracer(huskTracer),
});
```

## Span hierarchy you'll see

```
agent.run
├── provider:request (claude-opus-4-6)
├── tool:call (Read)
├── tool:result (Read)
├── provider:request (claude-opus-4-6)
└── agent:end
```

Each span has attributes like:
- `agent.session_id`
- `provider.model`
- `provider.usage.input_tokens`
- `provider.usage.output_tokens`
- `tool.name`
- `tool.duration_ms`

## How it works internally

`OtelTracerAdapter` (in `src/otel/index.ts`) implements Husk's
minimal `Tracer` interface by delegating to OTel's `Tracer`:
- `startSpan()` calls `otelTracer.startSpan()`
- `span.setAttribute()` maps to OTel's attribute API
- `span.end()` calls OTel's span end

`EventTracer` (in `src/obs/mapper.ts`) subscribes to
`AgentEventEmitter` and translates each event into a span:
- `agent:start` → root span
- `provider:request` → child span
- `provider:response` → child span with token usage attributes
- `tool:call` → child span
- `tool:result` → child span
- `agent:end` → end of root span

The two compose: `new EventTracer(new OtelTracerAdapter(otel))`
gives you OTel spans for every agent event with zero glue code.
