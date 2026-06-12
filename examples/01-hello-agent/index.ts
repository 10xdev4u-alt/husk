/**
 * Example 01 — Hello Agent.
 *
 * The smallest possible Husk agent. No tools, no memory, no steering.
 * Demonstrates: import surface, basic Agent construction, awaiting
 * agent.run(), and inspecting the result.
 *
 * Run: bun run examples/01-hello-agent/index.ts
 */

import { Agent, AnthropicProvider } from '../../src/index.js';

const agent = new Agent({
  model: new AnthropicProvider({
    model: 'claude-opus-4-6',
  }),
});

const result = await agent.run('What is the capital of France? Answer in one sentence.');

// eslint-disable-next-line no-console
console.log('\n--- Final Output ---');
// eslint-disable-next-line no-console
console.log(result.output);
// eslint-disable-next-line no-console
console.log('\n--- Stats ---');
// eslint-disable-next-line no-console
console.log(`Iterations: ${result.iterations}`);
console.log(`Input tokens:  ${result.usage.inputTokens}`);
console.log(`Output tokens: ${result.usage.outputTokens}`);
console.log(`Duration:      ${result.durationMs}ms`);
