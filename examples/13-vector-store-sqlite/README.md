# Example 13 — Persistent vector memory with SqliteVectorStore

v0.3.0 shipped `InMemoryVectorStore` for sessions. v0.5.0 shipped the `VectorStore` interface. v0.7.0 fills in the first concrete **persistent** impl: `SqliteVectorStore`, backed by SQLite + the `sqlite-vec` extension.

Vectors survive process restarts (they're on disk). The implementation uses the same `VectorStore` interface as the in-memory one, so swapping is a one-line change.

## Setup

```bash
cd examples/13-vector-store-sqlite
bun add @princetheprogrammerbtw/husk better-sqlite3 sqlite-vec
bun run index.ts
```

## What you'll see

```
→ Direct search: "What database does the project use?"

  mem-2: The project uses PostgreSQL for the main database. (score: 0.823)
  mem-1: The user prefers TypeScript with strict mode enabled. (score: 0.412)

→ Agent-driven search: same query, but routed through the agent

  Agent: Based on memory mem-2, the project uses PostgreSQL for the main database.

→ All memories in the store:
  mem-1: The user prefers TypeScript with strict mode enabled.
  mem-2: The project uses PostgreSQL for the main database.
  mem-3: Deploys are triggered by pushing to the main branch.

✓ Done. Vectors persisted to ./.husk/vectors.db
  Re-run this script to verify the data survives process restart.
```

## What this demonstrates

- **`SqliteVectorStore.open({ path, dimension })`** creates the DB file + vec0 table on first call, auto-creates the parent directory.
- **Vectors persist across process restarts** — the persistence test in `tests/vector-sqlite.test.ts` is the load-bearing assertion.
- **`defineMemorySearchTool` + `defineRememberTool`** wrap the store as Husk tools, so the agent can recall and store memories via standard tool calls.
- **`HashEmbedder` (zero-dep)** for deterministic offline embeddings. Real apps swap in OpenAI / Voyage / Cohere.
- **Same `VectorStore` interface as `InMemoryVectorStore`** — swap one for the other with no other code changes.

## Library usage

```ts
import { Agent, AnthropicProvider, SqliteVectorStore, HashEmbedder } from '@princetheprogrammerbtw/husk';

const store = await SqliteVectorStore.open({
  path: './.husk/vectors.db',
  dimension: 1536,  // match your embedder's output
});

const embedder = new HashEmbedder({ dimension: 1536 });

const rememberTool = defineRememberTool({ store, embedder });
const searchTool = defineMemorySearchTool({ store, embedder });

const agent = new Agent({
  model: new AnthropicProvider(),
  tools: [rememberTool, searchTool],
});

await agent.run('Remember that the deploy pipeline uses GitHub Actions.');
await agent.run('How do we deploy?');  // recalls the memory via searchTool

await store.close();
```

## Swapping to OpenAI embeddings

```ts
import OpenAI from 'openai';
import type { EmbeddingProvider } from '@princetheprogrammerbtw/husk';

const openai = new OpenAI();

const embedder: EmbeddingProvider = {
  dimension: 1536,
  async embed(text: string): Promise<number[]> {
    const res = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return res.data[0]!.embedding;
  },
};

const store = await SqliteVectorStore.open({ path: './vectors.db', dimension: 1536 });
// ... same as before, but with real embeddings
```

## Direct (no agent) usage

```ts
await store.upsert({ id: '1', content: 'hello', embedding: [1, 0, 0, 0] });
const results = await store.search(new Float32Array([1, 0, 0, 0]), 5);
await store.remove('1');
await store.list();
await store.clear();
await store.close();
```

Full `VectorStore` interface — drop-in replacement for `InMemoryVectorStore`.

## How it works internally

`SqliteVectorStore` is a thin wrapper over `better-sqlite3` + the `sqlite-vec` extension. It creates a `vec0` virtual table (sqlite-vec's ANN-capable table type) with the configured dimension, then routes:

- `upsert()` → `INSERT OR REPLACE INTO husk_vectors (id, content, embedding) VALUES (?, ?, ?)`
- `search()` → `SELECT id, content, distance FROM husk_vectors WHERE embedding MATCH ? ORDER BY distance LIMIT k`
- `remove()` → `DELETE FROM husk_vectors WHERE id = ?`

The embedding column is stored as a packed `float[N]` blob (sqlite-vec's native vector type). Distance is L2 by default; we negate it to produce a similarity-like score (higher is better), matching the rest of Husk's `VectorStore` impls.

WAL mode is enabled for concurrent reads + serialized writes. The DB file is the only persistent state — no separate metadata file, no separate embedding cache.

## Limitations (v0.7.0)

- **No metadata filtering** — the `MemoryItem.metadata` field is preserved in the public API but not yet queryable. A future v0.8 will add `search({ filter: { source: 'email' } })`.
- **Single embedding model at a time** — the store is bound to one `dimension`. To switch models, open a new store with the new dimension.
- **No automatic reindexing** — if you change the embedder, the existing vectors are stale. Delete the DB file and re-ingest.
- **No remote/S3 storage** — the file path is always local. Cloud backends are a v0.8+ direction.

## Why SQLite + sqlite-vec

- **Zero ops** — single file, no server, no auth, no ports.
- **Fast** — sqlite-vec's vec0 uses a custom IVF/HNSW-like index; queries on 10k+ vectors are sub-millisecond.
- **No external deps** — better-sqlite3 has a prebuild for every common platform (macOS arm64/x64, Linux glibc/musl, Windows).
- **Standard SQL** — you can `sqlite3 vectors.db` and run queries directly.

For larger scales (millions of vectors, distributed setups), swap to a dedicated vector DB like Qdrant or Pinecone. The `VectorStore` interface stays the same; only the impl changes.
