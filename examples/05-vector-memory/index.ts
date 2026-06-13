/**
 * Example 05 — Vector Memory.
 *
 * An agent that remembers user preferences across sessions using
 * Husk's vector memory. The first "session" teaches the agent a
 * preference; the second session asks the agent to recall it.
 *
 * Uses the HashEmbedder (deterministic, no API key needed) and
 * InMemoryVectorStore. For real semantic search and persistence,
 * see the README for upgrade instructions.
 *
 * Run: bun run examples/05-vector-memory/index.ts
 */

import {
  Agent,
  HashEmbedder,
  InMemoryVectorStore,
  defineMemorySearchTool,
  defineRememberTool,
} from '../../src/index.js';

const store = new InMemoryVectorStore();
const embedder = new HashEmbedder();

const agent = new Agent({
  model: {
    name: 'fake',
    model: 'fake',
    chat: async (request) => {
      // A canned "fake model" that decides what to do based on the
      // current tool history. Real agents use a real LLM.
      const lastMessage = request.messages[request.messages.length - 1];
      const text = typeof lastMessage?.content === 'string' ? lastMessage.content : '';

      // If the agent is being asked to teach a preference, simulate
      // calling the Remember tool.
      if (text.includes('I prefer TypeScript with strict mode')) {
        return {
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use' as const,
                id: 'tu-1',
                name: 'Remember',
                input: { id: 'pref-lang', content: 'user prefers TypeScript with strict mode' },
              },
            ],
          },
          usage: { inputTokens: 50, outputTokens: 30 },
          stopReason: 'tool_use' as const,
          model: 'fake',
        };
      }

      // If the agent is being asked for a recommendation, simulate
      // calling MemorySearch.
      if (text.includes('recommend a language')) {
        return {
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use' as const,
                id: 'tu-2',
                name: 'MemorySearch',
                input: { query: 'language preference' },
              },
            ],
          },
          usage: { inputTokens: 50, outputTokens: 30 },
          stopReason: 'tool_use' as const,
          model: 'fake',
        };
      }

      // Default: end turn with a summary.
      return {
        message: { role: 'assistant', content: 'Done.' },
        usage: { inputTokens: 10, outputTokens: 5 },
        stopReason: 'end_turn' as const,
        model: 'fake',
      };
    },
  },
  tools: [defineMemorySearchTool({ store, embedder }), defineRememberTool({ store, embedder })],
  maxIterations: 3,
});

console.log('=== Session 1: teach the agent a preference ===');
const r1 = await agent.run('I prefer TypeScript with strict mode. Please remember this.');
console.log(`Output: ${r1.output}`);
console.log(`Iterations: ${r1.iterations}`);
console.log(`Memory now contains: ${await store.list()}`);

console.log('\n=== Session 2: ask for a recommendation (the agent should recall) ===');
const r2 = await agent.run(
  'Based on what you know about me, recommend a language for a new project.',
);
console.log(`Output: ${r2.output}`);
console.log(`Iterations: ${r2.iterations}`);

console.log(`\n=== Final memory state ===`);
console.log(`Total memories: ${await store.count()}`);
for (const id of await store.list()) {
  const results = await store.search(await embedder.embed(id), 1);
  console.log(`  ${id}: ${JSON.stringify(results[0]?.content)}`);
}
