/**
 * Husk — SqliteVectorStore.
 *
 * Persistent vector memory backed by SQLite + sqlite-vec. v0.3.0
 * shipped InMemoryVectorStore for sessions; v0.5.0 shipped the
 * VectorStore interface; v0.7.0 fills in the first concrete
 * persistent impl.
 *
 * The backend is `vec0` (the sqlite-vec virtual table for
 * embedding similarity search). Storage is on disk, so vectors
 * survive process restarts. The `node:sqlite` built-in is
 * available in Node 22+; we also support `better-sqlite3` for
 * broader compatibility (the user passes the instance).
 *
 * v0.7.0 ships the API + a default constructor that wires up
 * better-sqlite3 + sqlite-vec. Lazy-loads both libraries so
 * users who never touch persistent vectors pay zero cost.
 *
 * Usage:
 *
 *   import { SqliteVectorStore } from '@princetheprogrammerbtw/husk';
 *
 *   const store = await SqliteVectorStore.open({
 *     path: './.husk/vectors.db',
 *     dimension: 1536,  // match your embedder's output
 *   });
 *
 *   await store.insert({ id: '1', content: 'hello', embedding: await embedder.embed('hello') });
 *   const results = await store.search(queryEmbedding, 5);
 *
 *   await store.close();
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { MemoryItem, SearchResult, VectorStore } from './vector.js';

/** Module-level type for the better-sqlite3 Database class (lazy-loaded). */
interface BetterSqlite3Database {
  exec(sql: string): void;
  prepare(sql: string): BetterSqlite3Statement;
  close(): void;
}

interface BetterSqlite3Statement {
  run(...params: unknown[]): BetterSqlite3RunResult;
  all(...params: unknown[]): Array<Record<string, unknown>>;
  get(...params: unknown[]): Record<string, unknown> | undefined;
}

interface BetterSqlite3RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

interface SqliteVecLoader {
  load(db: BetterSqlite3Database): void;
}

let betterSqlite3Cache: (new (path: string) => BetterSqlite3Database) | undefined;
let sqliteVecCache: SqliteVecLoader | undefined;

async function loadBetterSqlite3(): Promise<new (path: string) => BetterSqlite3Database> {
  if (betterSqlite3Cache) return betterSqlite3Cache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import('better-sqlite3')) as Record<string, unknown>;
    betterSqlite3Cache = (mod.default ?? mod) as new (path: string) => BetterSqlite3Database;
    return betterSqlite3Cache;
  } catch (err) {
    if (err instanceof Error && /Cannot find module/.test(err.message)) {
      throw new Error(
        "The 'better-sqlite3' package isn't installed. Run `npm install better-sqlite3` and try again. It's an optional peer dep — Husk only needs it for SqliteVectorStore.",
      );
    }
    throw err;
  }
}

async function loadSqliteVec(): Promise<SqliteVecLoader> {
  if (sqliteVecCache) return sqliteVecCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import('sqlite-vec')) as Record<string, unknown>;
    const loader = (mod.load ?? (mod.default as Record<string, unknown> | undefined)?.load) as
      | SqliteVecLoader
      | undefined;
    if (!loader) throw new Error('sqlite-vec: load() not found in module');
    sqliteVecCache = loader;
    return sqliteVecCache;
  } catch (err) {
    if (err instanceof Error && /Cannot find module/.test(err.message)) {
      throw new Error(
        "The 'sqlite-vec' package isn't installed. Run `npm install sqlite-vec` and try again. It's an optional peer dep — Husk only needs it for SqliteVectorStore.",
      );
    }
    throw err;
  }
}

/** Options for opening a SqliteVectorStore. */
export interface SqliteVectorStoreOptions {
  /** Path to the SQLite database file. Created if it doesn't exist. */
  readonly path: string;
  /** Dimension of the embedding vectors. Must match the embedder's output. */
  readonly dimension: number;
  /** Table name to use. Default: 'husk_vectors'. */
  readonly tableName?: string;
}

/** Result returned by the static open() factory. */
export interface SqliteVectorStoreHandle extends VectorStore {
  /** Close the database. Idempotent. */
  close(): void;
}

export const SqliteVectorStore = {
  /**
   * Open a persistent vector store at the given path. Creates
   * the parent dir if missing, the DB file if missing, the
   * vec0 table if missing. Lazy-loads better-sqlite3 + sqlite-vec
   * on first call.
   *
   * Throws if either peer dep isn't installed.
   */
  async open(options: SqliteVectorStoreOptions): Promise<SqliteVectorStoreHandle> {
    const Database = await loadBetterSqlite3();
    const sqliteVec = await loadSqliteVec();

    // Make sure the parent dir exists.
    const dir = join(options.path, '..');
    await mkdir(dir, { recursive: true });

    const db = new Database(options.path);
    sqliteVec.load(db);

    const tableName = options.tableName ?? 'husk_vectors';
    const dimension = options.dimension;

    // Enable WAL for concurrent reads + serialized writes.
    db.exec('PRAGMA journal_mode = WAL');
    // Create the vec0 table if it doesn't exist. The 'embedding'
    // column is the float[N] vector; we add 'id' and 'content'
    // as auxiliary text columns for retrieval.
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${tableName} USING vec0(
        id TEXT PRIMARY KEY,
        content TEXT,
        embedding float[${dimension}]
      )
    `);

    // Prepared statements for the four operations.
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO ${tableName} (id, content, embedding)
      VALUES (?, ?, ?)
    `);
    const searchStmt = db.prepare(`
      SELECT id, content, distance
      FROM ${tableName}
      WHERE embedding MATCH ?
      ORDER BY distance
      LIMIT ?
    `);
    const deleteStmt = db.prepare(`DELETE FROM ${tableName} WHERE id = ?`);
    const clearStmt = db.prepare(`DELETE FROM ${tableName}`);
    let closed = false;
    const handle: SqliteVectorStoreHandle = {
      async upsert(item: MemoryItem): Promise<void> {
        if (closed) throw new Error('SqliteVectorStore: store is closed');
        // item.embedding is number[]; convert to Float32Array.
        // The as Float32Array casts away the readonly.
        const vec = new Float32Array(item.embedding as number[]);
        insertStmt.run(item.id, item.content, vec);
      },

      async search(
        queryEmbedding: readonly number[],
        topK: number,
      ): Promise<readonly SearchResult[]> {
        if (closed) throw new Error('SqliteVectorStore: store is closed');
        const rows = searchStmt.all(new Float32Array(queryEmbedding as number[]), topK) as Array<{
          id: string;
          content: string;
          distance: number;
        }>;
        // No re-embedding needed for SearchResult.score — sqlite-vec
        // returns a distance, lower is better. Negate so higher
        // is better, matching Husk's other VectorStore impls.
        return rows.map((r) => ({
          id: r.id,
          content: r.content,
          score: -r.distance,
        }));
      },

      async remove(id: string): Promise<void> {
        if (closed) throw new Error('SqliteVectorStore: store is closed');
        deleteStmt.run(id);
      },

      async list(): Promise<readonly string[]> {
        if (closed) throw new Error('SqliteVectorStore: store is closed');
        const rows = db.prepare(`SELECT id FROM ${tableName}`).all() as Array<{ id: string }>;
        return rows.map((r) => r.id);
      },

      async count(): Promise<number> {
        if (closed) throw new Error('SqliteVectorStore: store is closed');
        const row = db.prepare(`SELECT COUNT(*) as n FROM ${tableName}`).get() as { n: number };
        return row.n;
      },

      async clear(): Promise<void> {
        if (closed) throw new Error('SqliteVectorStore: store is closed');
        clearStmt.run();
      },

      close(): void {
        if (closed) return;
        closed = true;
        db.close();
      },
    };
    return handle;
  },
};
