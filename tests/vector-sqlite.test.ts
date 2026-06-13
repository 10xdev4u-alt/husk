/**
 * Tests for v0.7.0's SqliteVectorStore.
 *
 * Coverage:
 *   - open() creates the DB file and table
 *   - upsert + search round-trips
 *   - search returns the right top-K (smaller distance = higher score)
 *   - remove() deletes a specific id
 *   - list() returns all ids
 *   - clear() empties the store
 *   - count() reports the right number
 *   - persistence: vectors survive a close + reopen
 *   - close() is idempotent
 *
 * better-sqlite3 is a native module that doesn't work in Bun's
 * runtime (as of 1.3.12 — see https://github.com/oven-sh/bun/issues/4290).
 * These tests pass on Node + tsx (the production runtime for
 * Husk users), but we skip them under Bun to keep `bun test`
 * working for the rest of the suite.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteVectorStore } from '../src/memory/vector-sqlite.js';

const SKIP = typeof Bun !== 'undefined';
const DIMENSION = 4;

let workDir: string;
let dbPath: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'husk-sqlite-vec-'));
  dbPath = join(workDir, 'vectors.db');
});

afterEach(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

function vec(a: number[]): Float32Array {
  return new Float32Array(a);
}

describe.skipIf(SKIP)('SqliteVectorStore — open()', () => {
  test('creates the database file and table on first open', async () => {
    expect(existsSync(dbPath)).toBe(false);
    const store = await SqliteVectorStore.open({ path: dbPath, dimension: DIMENSION });
    expect(existsSync(dbPath)).toBe(true);
    const info = await stat(dbPath);
    expect(info.size).toBeGreaterThan(0);
    expect(await store.count()).toBe(0);
    await store.close();
  });

  test('parent directory is created if missing', async () => {
    const nestedPath = join(workDir, 'a', 'b', 'c', 'vectors.db');
    expect(existsSync(join(workDir, 'a'))).toBe(false);
    const store = await SqliteVectorStore.open({ path: nestedPath, dimension: DIMENSION });
    expect(existsSync(nestedPath)).toBe(true);
    await store.close();
  });
});

describe.skipIf(SKIP)('SqliteVectorStore — upsert + search', () => {
  test('round-trips a single vector', async () => {
    const store = await SqliteVectorStore.open({ path: dbPath, dimension: DIMENSION });
    await store.upsert({
      id: '1',
      content: 'hello',
      embedding: [1, 0, 0, 0],
    });
    const results = await store.search(vec([1, 0, 0, 0]), 5);
    expect(results.length).toBe(1);
    expect(results[0]?.id).toBe('1');
    expect(results[0]?.content).toBe('hello');
    await store.close();
  });

  test('returns top-K sorted by similarity (closest first)', async () => {
    const store = await SqliteVectorStore.open({ path: dbPath, dimension: DIMENSION });
    await store.upsert({ id: 'a', content: 'exact', embedding: [1, 0, 0, 0] });
    await store.upsert({ id: 'b', content: 'close', embedding: [0.9, 0.1, 0, 0] });
    await store.upsert({ id: 'c', content: 'far', embedding: [0, 0, 0, 1] });
    const results = await store.search(vec([1, 0, 0, 0]), 3);
    expect(results.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? Number.NEGATIVE_INFINITY);
    expect(results[1]?.score).toBeGreaterThan(results[2]?.score ?? Number.NEGATIVE_INFINITY);
    await store.close();
  });

  test('respects topK limit', async () => {
    const store = await SqliteVectorStore.open({ path: dbPath, dimension: DIMENSION });
    for (let i = 0; i < 10; i++) {
      await store.upsert({ id: `id-${i}`, content: `c-${i}`, embedding: [i, 0, 0, 0] });
    }
    const results = await store.search(vec([0, 0, 0, 0]), 3);
    expect(results.length).toBe(3);
    await store.close();
  });

  test('returns empty array for an empty store', async () => {
    const store = await SqliteVectorStore.open({ path: dbPath, dimension: DIMENSION });
    const results = await store.search(vec([1, 0, 0, 0]), 5);
    expect(results).toEqual([]);
    await store.close();
  });
});

describe.skipIf(SKIP)('SqliteVectorStore — remove + list + clear + count', () => {
  test('remove() deletes a specific id', async () => {
    const store = await SqliteVectorStore.open({ path: dbPath, dimension: DIMENSION });
    await store.upsert({ id: 'a', content: 'a', embedding: [1, 0, 0, 0] });
    await store.upsert({ id: 'b', content: 'b', embedding: [0, 1, 0, 0] });
    await store.remove('a');
    const ids = await store.list();
    expect(ids).toEqual(['b']);
    await store.close();
  });

  test('remove() is a no-op for missing ids', async () => {
    const store = await SqliteVectorStore.open({ path: dbPath, dimension: DIMENSION });
    await store.upsert({ id: 'a', content: 'a', embedding: [1, 0, 0, 0] });
    await store.remove('nonexistent');
    expect(await store.count()).toBe(1);
    await store.close();
  });

  test('list() returns all ids', async () => {
    const store = await SqliteVectorStore.open({ path: dbPath, dimension: DIMENSION });
    await store.upsert({ id: 'a', content: 'a', embedding: [1, 0, 0, 0] });
    await store.upsert({ id: 'b', content: 'b', embedding: [0, 1, 0, 0] });
    await store.upsert({ id: 'c', content: 'c', embedding: [0, 0, 1, 0] });
    const ids = await store.list();
    expect(ids.sort()).toEqual(['a', 'b', 'c']);
    await store.close();
  });

  test('clear() empties the store', async () => {
    const store = await SqliteVectorStore.open({ path: dbPath, dimension: DIMENSION });
    await store.upsert({ id: 'a', content: 'a', embedding: [1, 0, 0, 0] });
    await store.upsert({ id: 'b', content: 'b', embedding: [0, 1, 0, 0] });
    expect(await store.count()).toBe(2);
    await store.clear();
    expect(await store.count()).toBe(0);
    await store.close();
  });

  test('count() reports the right number', async () => {
    const store = await SqliteVectorStore.open({ path: dbPath, dimension: DIMENSION });
    expect(await store.count()).toBe(0);
    await store.upsert({ id: '1', content: 'a', embedding: [1, 0, 0, 0] });
    expect(await store.count()).toBe(1);
    await store.upsert({ id: '2', content: 'b', embedding: [0, 1, 0, 0] });
    expect(await store.count()).toBe(2);
    await store.close();
  });
});

describe.skipIf(SKIP)('SqliteVectorStore — persistence', () => {
  test('vectors survive a close + reopen', async () => {
    let store = await SqliteVectorStore.open({ path: dbPath, dimension: DIMENSION });
    await store.upsert({ id: 'persist-1', content: 'survives', embedding: [1, 0, 0, 0] });
    await store.close();

    store = await SqliteVectorStore.open({ path: dbPath, dimension: DIMENSION });
    const ids = await store.list();
    expect(ids).toEqual(['persist-1']);
    const results = await store.search(vec([1, 0, 0, 0]), 1);
    expect(results[0]?.id).toBe('persist-1');
    expect(results[0]?.content).toBe('survives');
    await store.close();
  });
});

describe.skipIf(SKIP)('SqliteVectorStore — close()', () => {
  test('is idempotent', async () => {
    const store = await SqliteVectorStore.open({ path: dbPath, dimension: DIMENSION });
    await store.close();
    await store.close();
  });
});
