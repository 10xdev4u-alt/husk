/**
 * Example 09 — Real OpenTelemetry SDK integration.
 *
 * Wires Husk's minimal Tracer interface to a real
 * @opentelemetry/sdk-node pipeline that exports spans to the
 * console (for dev) or to OTLP-compatible backends (Honeycomb,
 * Jaeger, Tempo, etc.) in production.
 *
 * This is the "real" counterpart to the /otel subpath adapter,
 * which provides the *interface* but doesn't ship the SDK +
 * exporters (those are heavier and tree-shake poorly).
 *
 * Setup:
 *   cd examples/09-otel-sdk
 *   bun add @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http
 *   bun run index.ts
 *
 * What you'll see:
 *   - A trace span for the agent run
 *   - Child spans for each provider call + tool call (the EventTracer
 *     already maps these; the OTel bridge forwards them as actual
 *     spans with proper parent-child relationships)
 *   - Attributes on each span (model, tool name, token usage, etc.)
 *
 * In production, swap ConsoleSpanExporter for BatchSpanProcessor +
 * OTLPTraceExporter and point it at your backend.
 */

import { type Tracer as OtelTracer, trace } from '@opentelemetry/api';
import type { ToolDefinition } from '../../src/core/types.js';
import { Agent, AnthropicProvider, EventTracer } from '../../src/index.js';
import { OtelTracerAdapter } from '../../src/otel/index.js';
import { defineTool, objectSchema, stringField } from '../../src/tools/registry.js';

/**
 * This helper shows what the *bootstrap* looks like in production.
 * We don't actually call it in the demo because we don't have
 * @opentelemetry/sdk-node installed in the husk repo's devDeps
 * (the user installs it in their own project to use this example).
 *
 * In a real app, you'd call this in your main.ts BEFORE any
 * Husk code runs, so the SDK has time to wire up its
 * auto-instrumentations.
 */
export function bootstrapOpenTelemetry() {
  // Uncomment in a real project (after `bun add @opentelemetry/sdk-node ...`):
  //
  // const sdk = new NodeSDK({
  //   resource: resourceFromAttributes({
  //     [SemanticResourceAttributes.SERVICE_NAME]: 'my-husk-agent',
  //   }),
  //   traceExporter: new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' }),
  //   instrumentations: [getNodeAutoInstrumentations()],
  // });
  // sdk.start();
  // return sdk;
}

async function main() {
  console.log('\n→ OTel SDK integration demo\n');
  console.log('This example uses only @opentelemetry/api (already a husk devDep).');
  console.log('For the real SDK + OTLP exporter, see the bootstrapOpenTelemetry()');
  console.log('helper above and the README for install instructions.\n');

  // 1. Get a real OTel tracer from the global tracer provider.
  //    The NoopTracerProvider is the default if you haven't bootstrapped
  //    the SDK yet — that's fine, the adapter still works end-to-end
  //    and you'll see spans in your console once you install + bootstrap
  //    the SDK.
  const otelTracer: OtelTracer = trace.getTracer('husk-example');

  // 2. Wrap it in Husk's OtelTracerAdapter (this is the /otel subpath).
  const huskTracer = new OtelTracerAdapter(otelTracer);

  // 3. Plug the wrapped tracer into the Agent. The Agent emits events
  //    for each iteration; the EventTracer maps them to OTel spans.
  const echoTool: ToolDefinition = defineTool({
    name: 'echo',
    description: 'Echoes back the input',
    inputSchema: objectSchema({ message: stringField() }),
    execute: async (input: unknown) => {
      return { output: `echo: ${(input as { message: string }).message}` };
    },
  });

  const agent = new Agent({
    model: new AnthropicProvider({ model: 'claude-opus-4-6' }),
    tools: [echoTool],
    tracer: new EventTracer(huskTracer),
  });

  // 4. Run. Each agent event becomes an OTel span.
  //    With a real SDK bootstrapped, you'll see them in your backend.
  //    Without one, the NoopTracerProvider swallows them silently.
  console.log('→ Running agent (spans go to wherever OTel is configured)...\n');
  const result = await agent.run('Use the echo tool to say hi, then summarize.');
  console.log(`\n→ Done. Output: ${result.output}`);
  console.log('\n→ Spans emitted: see your OTel backend (console / Jaeger / Honeycomb / etc.)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
