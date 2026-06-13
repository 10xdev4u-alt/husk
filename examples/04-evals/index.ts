/**
 * Example 04 — Eval Suite.
 *
 * Demonstrates Husk's eval runner with a tiny suite that asserts
 * the hello-agent's output for a geography question. No API key
 * required — uses a canned-output fake agent.
 *
 * Run: bun run examples/04-evals/index.ts
 */

import {
  Agent,
  contains,
  defineSuite,
  lengthBetween,
  notContains,
  runSuite,
} from '../../src/index.js';

const geography = defineSuite({
  name: 'hello-agent-evals',
  cases: [
    {
      name: 'knows the capital of France',
      input: 'What is the capital of France? Answer in one short sentence.',
      assertions: [contains('Paris'), notContains('London'), lengthBetween(10, 100)],
    },
    {
      name: 'answers in one sentence',
      input: 'What is the capital of Japan?',
      assertions: [
        contains('Tokyo'),
        // Sentence count: rough heuristic. Real evals would use a more
        // sophisticated check or a dedicated assertion library.
      ],
    },
  ],
});

/**
 * Fake agent factory — returns canned output so the example runs
 * without an API key. For real evals, swap this for a real provider.
 */
const fakeFactory = async (): Promise<Agent> => {
  return new Agent({
    model: {
      name: 'fake',
      model: 'fake',
      chat: async (request) => {
        // Map input to canned output. A real eval would use a real model.
        const input = request.messages[request.messages.length - 1];
        const text = typeof input?.content === 'string' ? input.content : '';
        let reply = 'I do not know.';
        if (text.includes('France')) reply = 'The capital of France is Paris.';
        else if (text.includes('Japan')) reply = 'Tokyo is the capital of Japan.';
        return {
          message: { role: 'assistant', content: reply },
          usage: { inputTokens: text.length, outputTokens: reply.length },
          stopReason: 'end_turn' as const,
          model: 'fake',
        };
      },
    },
  });
};

const result = await runSuite(geography, fakeFactory);

console.log(`\n=== ${result.suiteName} ===`);
for (const r of result.results) {
  const icon = r.passed ? '✓' : '✗';
  console.log(`  ${icon} ${r.caseName}`);
  if (!r.passed) {
    for (const a of r.assertionResults) {
      console.log(`     ✗ ${a.name}: ${a.message ?? 'failed'}`);
    }
  }
}
console.log(`=== ${result.passed}/${result.total} passed in ${result.durationMs}ms ===`);

if (result.passed < result.total) {
  process.exit(1);
}
