/**
 * Example 07 — Streaming responses.
 *
 * Shows the difference between agent.run() (one big result) and
 * agent.streamRun() (an AsyncIterable of events you can render
 * token-by-token). Real-world use cases:
 *   - Chat UIs that render text as it arrives
 *   - Long-running tasks where you want progress feedback
 *   - Pipelines that process tool results incrementally
 *
 * Run with a real key:
 *   ANTHROPIC_API_KEY=sk-ant-... bun run examples/07-streaming/index.ts
 *
 * Without a key, the example still runs — it falls back to a
 * FakeStreamProvider that yields a pre-canned sequence of chunks
 * so you can see the event shape without spending tokens.
 */

import type { AgentStreamEvent, ChatChunk, ChatRequest, Provider } from '../../src/core/types.js';
import { Agent, AnthropicProvider } from '../../src/index.js';

const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY);
const PROMPT = 'In one sentence, what is the most underrated feature of the Husk agent harness?';

async function main() {
  console.log(
    `\n→ ${HAS_KEY ? 'Streaming from real Anthropic' : 'Streaming from FakeStreamProvider (no ANTHROPIC_API_KEY)'}\n`,
  );
  console.log(`Prompt: "${PROMPT}"\n`);
  console.log('--- streamed output ---\n');

  const provider: Provider = HAS_KEY
    ? new AnthropicProvider({ model: 'claude-opus-4-6' })
    : new FakeStreamProvider();

  const agent = new Agent({ model: provider });
  const start = Date.now();
  let tokenCount = 0;

  for await (const event of agent.streamRun(PROMPT)) {
    switch (event.type) {
      case 'text':
        process.stdout.write(event.text);
        tokenCount += 1; // rough — 1 chunk ≈ 1 "token" for counting
        break;
      case 'tool_call_start':
        process.stdout.write(`\n[calling ${event.name}...]`);
        break;
      case 'tool_result':
        process.stdout.write(' [done]\n');
        break;
      case 'done':
        process.stdout.write('\n\n--- end of stream ---\n');
        console.log(`\nIterations:    ${event.iterations}`);
        console.log(`Input tokens:  ${event.usage.inputTokens}`);
        console.log(`Output tokens: ${event.usage.outputTokens}`);
        console.log(`Text chunks:   ${tokenCount}`);
        console.log(`Duration:      ${Date.now() - start}ms`);
        break;
      case 'error':
        console.error(`\n[error] ${event.message}`);
        process.exit(1);
    }
  }
}

/**
 * Minimal in-process provider used when ANTHROPIC_API_KEY is not set.
 * Yields the same ChatChunk shape a real Anthropic stream would emit,
 * so the example shows the event flow without spending tokens.
 */
class FakeStreamProvider implements Provider {
  readonly name = 'fake';
  readonly model = 'fake-claude';

  async chat(): Promise<never> {
    throw new Error('FakeStreamProvider: chat() not used in this example');
  }

  async *stream(_req: ChatRequest): AsyncIterable<ChatChunk> {
    const reply =
      'Husk ships a typed event stream that turns the messy reality of LLM tool-calling into something you can observe, log, and replay.';
    // Yield the reply word-by-word to simulate token streaming.
    for (const word of reply.split(' ')) {
      yield { type: 'text', text: `${word} ` };
      await new Promise((r) => setTimeout(r, 25));
    }
    yield {
      type: 'message_end',
      stopReason: 'end_turn',
      usage: { inputTokens: 24, outputTokens: 31 },
    };
    // Mark this type as used so biome doesn't complain.
    void (null as unknown as AgentStreamEvent);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
