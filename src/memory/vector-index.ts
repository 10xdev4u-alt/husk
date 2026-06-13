/**
 * Husk — vector memory module barrel.
 *
 * Public surface:
 *   import { InMemoryVectorStore, HashEmbedder, defineMemorySearchTool, defineRememberTool } from '@princetheprogrammerbtw/husk';
 *
 * For real embeddings, implement the EmbeddingProvider interface
 * yourself (OpenAI, Voyage, Cohere, sentence-transformers, etc.)
 * and pass it to defineMemorySearchTool/defineRememberTool.
 */

export { InMemoryVectorStore, cosineSimilarity } from './vector-inmemory.js';
export type { MemoryItem, SearchResult, VectorStore } from './vector.js';

export {
  HashEmbedder,
  type HashEmbedderOptions,
} from './embedder-hash.js';

export {
  defineMemorySearchTool,
  defineRememberTool,
  type MemoryToolOptions,
  type EmbeddingProvider,
} from './vector.js';

export {
  SqliteVectorStore,
  type SqliteVectorStoreOptions,
  type SqliteVectorStoreHandle,
} from './vector-sqlite.js';

export { matchesFilter } from './vector-filter.js';
export type { VectorFilter } from './vector-filter.js';
