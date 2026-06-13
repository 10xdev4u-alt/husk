/**
 * Example 13 — Persistent vector memory with SqliteVectorStore.
 *
 * v0.3.0 shipped InMemoryVectorStore for sessions. v0.5.0 shipped
 * the VectorStore interface. v0.7.0 fills in the first concrete
 * persistent impl: SqliteVectorStore, backed by SQLite + sqlite-vec.
 *
 * Vectors survive process restarts (they're on disk). The
 * implementation uses the same VectorStore interface as the
 * in-memory one, so swapping is a one-line change.
 *
 * Setup:
 *   cd examples/13-vector-store-sqlite
 *   bun add @princetheprogrammerbtw/husk better-sqlite3 sqlite-vec
 *   bun run index.ts
 */

import {
  Agent,
  AnthropicProvider,
  HashEmbedder,
  SqliteVectorStore,
  defineMemorySearchTool,
  defineRememberTool,
} from '../../src/index.js';

async function main() {
  // Open (or create) a persistent vector store at ./vectors.db
  const store = await SqliteVectorStore.open({
    path: './.husk/vectors.db',
    dimension: 256, // matches HashEmbedder's default
  });

  // Use the deterministic HashEmbedder (zero-dep, no API key needed).
  // For real apps swap in OpenAI / Voyage / Cohere.
  const embedder = new HashEmbedder({ dimension: 256 });

  // Seed with a few memories. In a real agent loop, defineRememberTool
  // would be called by the model when it wants to remember something.
  await store.upsert({
    id: 'mem-1',
    content: 'The user prefers TypeScript with strict mode enabled.',
    embedding: await embedder.embed('The user prefers TypeScript with strict mode enabled.'),
  });
  await store.upsert({
    id: 'mem-2',
    content: 'The project uses PostgreSQL for the main database.',
    embedding: await embedder.embed('The project uses PostgreSQL for the main database.'),
  });
  await store.upsert({
    id: 'mem-3',
    content: 'Deploys are triggered by pushing to the main branch.',
    embedding: await embedder.embed('Deploys are triggered by pushing to the main branch.'),
  });

  // Direct search — no agent needed
  console.log('→ Direct search: "What database does the project use?"\n');
  const queryVec = await embedder.embed('What database does the project use?');
  const results = await store.search(queryVec, 2);
  for (const r of results) {
    console.log(`  ${r.id}: ${r.content} (score: ${r.score.toFixed(3)})`);
  }
  console.log();

  // Agent-driven search via the memory search tool
  console.log('→ Agent-driven search: same query, but routed through the agent\n');
  const rememberTool = defineRememberTool({ store, embedder });
  const searchTool = defineMemorySearchTool({ store, embedder });
  const agent = new Agent({
    model: new AnthropicProvider({ model: 'claude-opus-4-6' }),
    tools: [rememberTool, searchTool],
  });
  const result = await agent.run('What database does the project use? Look it up in memory.');
  console.log(`\n  Agent: ${result.output}\n`);

  // Persistence demo: list everything in the store
  console.log('→ All memories in the store:\n');
  const ids = await store.list();
  for (const id of ids) {
    const items = await store.search(await embedder.embed(''), 100); // get all
    const item = items.find((i) => i.id === id);
    if (item) console.log(`  ${id}: ${item.content}`);
  }

  await store.close();
  console.log('\n✓ Done. Vectors persisted to ./.husk/vectors.db');
  console.log('  Re-run this script to verify the data survives process restart.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
