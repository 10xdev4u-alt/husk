# Example 05 — Vector Memory

Demonstrates an agent that **remembers user preferences across
sessions** using Husk's vector memory. The agent uses two
custom tools — `MemorySearch` and `Remember` — to recall and
store information in a persistent vector store.

## Run it

```bash
bun run examples/05-vector-memory/index.ts
```

The first run teaches the agent a preference ("user prefers
TypeScript with strict mode"). The second run asks the agent to
recommend a language — and it should recall the prior preference
via `MemorySearch`.

## What this demonstrates

- **VectorStore interface** — pluggable so users can swap in Chroma, Pinecone, etc.
- **InMemoryVectorStore** — zero-dep backend (also ships `FileStore`-style persistence is planned for v0.4)
- **HashEmbedder** — deterministic pseudo-embeddings for offline use (no API key needed)
- **`defineMemorySearchTool` / `defineRememberTool`** — tool factories that wrap the store + embedder
- **Tool-driven memory access** — the agent decides when to recall, no automatic injection

## Real-world usage

For real semantic search, swap `HashEmbedder` for a real
EmbeddingProvider (e.g. OpenAI's `text-embedding-3-small`):

```ts
import { OpenAI } from 'openai';
import type { EmbeddingProvider } from '@princetheprogrammerbtw/husk';

class OpenAIEmbedder implements EmbeddingProvider {
  readonly dimensions = 1536;
  constructor(private client: OpenAI) {}
  async embed(text: string) {
    const r = await this.client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return r.data[0]!.embedding;
  }
}
```

For persistent storage across process restarts, implement
`VectorStore` with a file-backed or sqlite-vec backend.
