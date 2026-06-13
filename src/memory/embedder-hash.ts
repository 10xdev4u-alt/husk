/**
 * Husk — simple embedding provider for testing and offline use.
 *
 * Produces deterministic pseudo-embeddings from text by hashing
 * character n-grams into a fixed-dimension vector. NOT a real
 * embedding model — semantic quality is poor, but it's:
 *
 * - Deterministic (same text → same vector)
 * - Zero-dependency (no API call, no model file)
 * - Useful for tests, demos, and offline development
 *
 * For real semantic search, use a real EmbeddingProvider:
 * - OpenAIEmbedder (text-embedding-3-small, 1536 dims)
 * - sentence-transformers via a small Python sidecar
 * - CohereEmbedder, VoyageEmbedder, etc.
 *
 * The "similarity" this produces is bag-of-chars similarity, not
 * semantic similarity. Two texts with similar character n-grams
 * will score high even if they mean different things.
 */

import type { EmbeddingProvider } from './vector.js';

export interface HashEmbedderOptions {
  /** Output vector dimensions. Default: 256. */
  readonly dimensions?: number;
  /** N-gram size for the hashing. Default: 3 (trigrams). */
  readonly ngramSize?: number;
}

export class HashEmbedder implements EmbeddingProvider {
  readonly dimensions: number;
  private readonly ngramSize: number;

  constructor(options: HashEmbedderOptions = {}) {
    this.dimensions = options.dimensions ?? 256;
    this.ngramSize = options.ngramSize ?? 3;
  }

  async embed(text: string): Promise<readonly number[]> {
    const vec = new Array<number>(this.dimensions).fill(0);
    const normalized = text.toLowerCase();

    for (let i = 0; i <= normalized.length - this.ngramSize; i++) {
      const ngram = normalized.slice(i, i + this.ngramSize);
      const hash = simpleHash(ngram);
      const idx = hash % this.dimensions;
      // Sign-of-hash for positive/negative contribution
      vec[idx] = (vec[idx] ?? 0) + (hash % 2 === 0 ? 1 : -1);
    }

    // L2-normalize so cosine similarity is well-behaved.
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (norm === 0) return vec;
    return vec.map((v) => v / norm);
  }
}

/**
 * A simple, deterministic string hash. Not cryptographic — just
 * spreads inputs across the bucket space. djb2 variant.
 */
function simpleHash(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 33) ^ s.charCodeAt(i);
  }
  // Make positive (signed-to-unsigned)
  return hash >>> 0;
}
