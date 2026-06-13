# Example 07 — Streaming responses

Demonstrates the difference between `agent.run()` (one big result) and
`agent.streamRun()` (an `AsyncIterable` of events you can render
token-by-token).

## Run it

```bash
# With a real API key — streams from Anthropic
ANTHROPIC_API_KEY=sk-ant-... bun run examples/07-streaming/index.ts

# Without a key — falls back to a FakeStreamProvider that yields
# word-by-word so you can see the event shape without spending tokens
bun run examples/07-streaming/index.ts
```

## What you'll see

```
→ Streaming from real Anthropic

Prompt: "In one sentence, what is the most underrated feature of the Husk agent harness?"

--- streamed output ---

The most underrated feature of the Husk agent harness is its typed event
stream that turns the messy reality of LLM tool-calling into something
you can observe, log, and replay.

--- end of stream ---

Iterations:    1
Input tokens:  24
Output tokens: 31
Text chunks:   28
Duration:      1234ms
```

## What this demonstrates

- **`agent.streamRun()` returns an `AsyncIterable<AgentStreamEvent>`** —
  text deltas, tool calls, tool results, and a final `done` event
  with usage totals. The consumer decides how to render each.
- **Real-time UX** — `process.stdout.write` shows text the moment it
  arrives. Perfect for chat UIs, progress bars, or any UI that wants
  to show the model "thinking."
- **Graceful fallback** — when `ANTHROPIC_API_KEY` isn't set, the
  example uses a `FakeStreamProvider` that yields pre-canned chunks
  word-by-word. Same `ChatChunk` shape the real Anthropic stream
  emits, so the event flow is identical.
- **Event types** — switch on `event.type` to handle `text`,
  `tool_call_start`, `tool_call_delta`, `tool_result`, `done`, and
  `error` each in their own way.

## Library usage

```ts
import { Agent, AnthropicProvider } from '@princetheprogrammerbtw/husk';

const agent = new Agent({
  model: new AnthropicProvider({ model: 'claude-opus-4-6' }),
  tools: [Read, Write, Edit, Bash, Grep], // optional
});

for await (const event of agent.streamRun('Refactor src/foo.ts')) {
  switch (event.type) {
    case 'text':
      process.stdout.write(event.text);
      break;
    case 'tool_call_start':
      console.log(`\n[calling ${event.name}...]`);
      break;
    case 'tool_result':
      console.log(`  result: ${event.result.output.slice(0, 60)}...`);
      break;
    case 'done':
      console.log(`\nDone in ${event.iterations} iter, ${event.usage.outputTokens} tokens out`);
      break;
  }
}
```

## CLI equivalent

```bash
husk run "What is 2 + 2?" --stream
```

The `--stream` flag wires `husk run` to `agent.streamRun()`. Text
goes to stdout; tool calls and results go to stderr so they don't
pollute the streamed output (useful when piping through `grep`,
`awk`, or `tee`).

## How it works internally

`streamRun()` mirrors `run()` exactly — same memory, same tools,
same iteration cap, same error isolation. The only difference is
the provider call: where `run()` calls `provider.chat()` and
returns a single `ChatResponse`, `streamRun()` calls
`provider.stream()` and yields `ChatChunk`s as they arrive.

Tool calls are buffered until their JSON input is complete, then
executed in parallel (same as `run()`). `tool_result` events are
emitted after the parallel batch resolves.

If the provider doesn't implement `stream()`, `streamRun()` falls
back to calling `run()` and yielding the complete response as a
single text event followed by `done`. Less interactive, but
functional.
