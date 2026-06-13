/**
 * Husk — in-memory vector store.
 *
 * Naive O(n) linear scan with cosine similarity. Fine for thousands
 * of memories; slow for millions. The VectorStore interface is
 * pluggable so users can swap in Chroma, Pinecone, sqlite-vec, or
 * any ANN index for production scale.
 *
 * Why we ship this: zero external dependencies, deterministic
 * behavior for testing, good enough for the common case of
 * "remember user preferences across sessions" (a few hundred items).
 *
 * For very large stores, see:
 * - chroma (separate server, ~3-line adapter)
 * - pinecone (managed, REST API)
 * - sqlite-vec (in-process, single binary)
 * - hnswlib-node (in-process, true ANN)
 */

import { type MemoryItem, type SearchResult, type VectorStore, matchesFilter } from './vector.js';

export class InMemoryVectorStore implements VectorStore {
  private readonly items: Map<string, MemoryItem> = new Map();

  async upsert(item: MemoryItem): Promise<void> {
    this.items.set(item.id, item);
  }

  async search(
    queryEmbedding: readonly number[],
    topK: number,
    options?: { readonly filter?: import('./vector.js').VectorFilter },
  ): Promise<readonly SearchResult[]> {
    if (this.items.size === 0) return [];
    if (topK <= 0) return [];

    const filter = options?.filter;
    const scored: SearchResult[] = [];
    for (const item of this.items.values()) {
      // Apply metadata filter before scoring (cheaper than scoring
      // then discarding).
      if (filter && !matchesFilter(item.metadata ?? {}, filter)) continue;
      const score = cosineSimilarity(queryEmbedding, item.embedding);
      scored.push({
        id: item.id,
        content: item.content,
        score,
        ...(item.metadata ? { metadata: item.metadata } : {}),
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  async remove(id: string): Promise<void> {
    this.items.delete(id);
  }

  async list(): Promise<readonly string[]> {
    return [...this.items.keys()];
  }

  async clear(): Promise<void> {
    this.items.clear();
  }

  async count(): Promise<number> {
    return this.items.size;
  }
}

// ───────────────────────────────────────────────────────────────────
// Math helpers
// ───────────────────────────────────────────────────────────────────

/**
 * Cosine similarity in [-1, 1]. Returns 0 if either vector is zero.
 * (1.0 = identical direction, 0 = orthogonal, -1 = opposite)
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}
