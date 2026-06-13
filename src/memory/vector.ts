/**
 * Husk — vector memory types and interfaces.
 *
 * Long-term memory for agents, separate from the short-term
 * Message[] memory in src/core/memory.ts. Vector stores are queried
 * by semantic similarity: you provide a query, get back the top-K
 * most similar past items.
 *
 * Design choice: the agent accesses vector memory through TOOLS
 * (MemorySearch, Remember) rather than automatic injection. This
 * means:
 * - The model decides when to recall (avoids noisy "here's some
 *   vaguely related past conversation" injections)
 * - The same memory store can be used by multiple agents
 * - Vector memory integrates with the existing tool framework, no
 *   agent-loop changes
 *
 * The VectorStore interface is intentionally simple so users can
 * plug in their own backend (Chroma, Pinecone, sqlite-vec, etc.).
 * Husk ships one in-memory backend for v0.3.0.
 */

import type { JSONSchema, JSONSchemaField, ToolDefinition } from '../core/types.js';

export { matchesFilter } from './vector-filter.js';
export type { VectorFilter } from './vector-filter.js';

// ───────────────────────────────────────────────────────────────────
// VectorStore — the storage interface
// ───────────────────────────────────────────────────────────────────

/**
 * A single memory item: the text, its embedding, and optional
 * metadata for filtering or display.
 */
export interface MemoryItem {
  /** Unique id (caller-provided, allows updates/deletes). */
  readonly id: string;
  /** The text content. What the model sees when this is recalled. */
  readonly content: string;
  /** Pre-computed embedding vector. */
  readonly embedding: readonly number[];
  /** Optional metadata (timestamp, source, tags, etc.). */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * The result of a similarity search: the matched item plus its
 * similarity score (higher = more similar). Score is implementation-
 * dependent (cosine similarity for the in-memory backend).
 */
export interface SearchResult {
  readonly id: string;
  readonly content: string;
  readonly score: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Metadata filter for vector searches. Matches a stored item's
 * `metadata` field against the provided clauses. The matching
 * is exact-equality by default; v0.8.0 ships `eq` and `in` only.
 *
 * Examples:
 *   { source: 'email' }                         // source === 'email'
 *   { source: 'email', priority: 'high' }      // source === 'email' AND priority === 'high'
 *   { source: { $in: ['email', 'slack'] } }    // source in ['email', 'slack']
 *   { tags: { $contains: 'urgent' } }          // tags array contains 'urgent'
 *
 * Backends translate this into their native filter language
 * (sqlite-vec: WHERE clauses on auxiliary columns; in-memory:
 * straight object comparison; cloud: provider-specific filters).
 */

export interface VectorStore {
  /** Add or update a memory item. */
  upsert(item: MemoryItem): Promise<void>;
  /**
   * Search for the top-K most similar items to the query embedding,
   * optionally filtered by metadata. v0.8.0 adds the optional
   * `filter` parameter; backends that don't support filtering
   * simply ignore it (return all matches).
   */
  search(
    queryEmbedding: readonly number[],
    topK: number,
    options?: { readonly filter?: import('./vector-filter.js').VectorFilter },
  ): Promise<readonly SearchResult[]>;
  /** Remove a memory by id. No-op if not present. */
  remove(id: string): Promise<void>;
  /** List all memory ids (for debugging/inspection). */
  list(): Promise<readonly string[]>;
  /** Remove all memories. */
  clear(): Promise<void>;
  /** Total count of memories. */
  count(): Promise<number>;
}

// ───────────────────────────────────────────────────────────────────
// EmbeddingProvider — converts text to vectors
// ───────────────────────────────────────────────────────────────────

export interface EmbeddingProvider {
  /** Generate an embedding vector for the given text. */
  embed(text: string): Promise<readonly number[]>;
  /** The dimensionality of the vectors this provider produces. */
  readonly dimensions: number;
}

// ───────────────────────────────────────────────────────────────────
// Tool factories — the agent-facing surface
// ───────────────────────────────────────────────────────────────────

export interface MemoryToolOptions {
  /** The vector store to read/write. */
  readonly store: VectorStore;
  /** The embedding provider (used inside the tools). */
  readonly embedder: EmbeddingProvider;
  /**
   * Default top-K for searches when the agent doesn't specify.
   * Default: 5.
   */
  readonly defaultTopK?: number;
}

/**
 * Build the MemorySearch tool: agent calls it with a natural-
 * language query, gets back the top-K most similar past items.
 */
export function defineMemorySearchTool(
  options: MemoryToolOptions,
): ToolDefinition<{ query: string; topK?: number }> {
  const { store, embedder, defaultTopK = 5 } = options;
  return {
    name: 'MemorySearch',
    description:
      'Search long-term memory for past interactions. Use this when the user references something you might have seen before, or when you need context that is not in the current conversation.',
    inputSchema: makeMemorySearchSchema(),
    execute: async (input) => {
      const embedding = await embedder.embed(input.query);
      const topK = input.topK ?? defaultTopK;
      const results = await store.search(embedding, topK);
      if (results.length === 0) {
        return { output: 'No matching memories found.' };
      }
      return {
        output: results.map((r) => `[score=${r.score.toFixed(3)}] ${r.content}`).join('\n'),
      };
    },
  };
}

/**
 * Build the Remember tool: agent calls it to save a fact/observation
 * to long-term memory for later recall.
 */
export function defineRememberTool(
  options: MemoryToolOptions,
): ToolDefinition<{ id: string; content: string }> {
  const { store, embedder } = options;
  return {
    name: 'Remember',
    description:
      'Save a piece of information to long-term memory. The next time you (or another agent) need this, call MemorySearch to recall it. Use this for user preferences, important decisions, or any fact that should survive across sessions.',
    inputSchema: makeRememberSchema(),
    execute: async (input) => {
      const embedding = await embedder.embed(input.content);
      await store.upsert({ id: input.id, content: input.content, embedding });
      return { output: `Remembered: ${input.content.slice(0, 80)}` };
    },
  };
}

// ───────────────────────────────────────────────────────────────────
// Schema builders (kept private to this module)
// ───────────────────────────────────────────────────────────────────

function makeMemorySearchSchema(): JSONSchema {
  const properties: Record<string, JSONSchemaField> = {
    query: { type: 'string', description: 'Natural-language search query.' },
    topK: { type: 'integer', description: 'Number of results to return. Default: 5.' },
  };
  return { type: 'object', properties, required: ['query'] };
}

function makeRememberSchema(): JSONSchema {
  const properties: Record<string, JSONSchemaField> = {
    id: { type: 'string', description: 'Unique identifier for this memory (caller-provided).' },
    content: { type: 'string', description: 'The text to remember.' },
  };
  return { type: 'object', properties, required: ['id', 'content'] };
}
