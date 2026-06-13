/**
 * Tests for v0.8.0's metadata filtering on vector stores.
 *
 * Coverage:
 *   - matchesFilter (the canonical matcher)
 *     - exact value (string/number/boolean)
 *     - $in operator
 *     - $contains operator (string + array)
 *     - $exists operator
 *     - multiple clauses ANDed
 *     - missing keys treated as not-matching
 *   - InMemoryVectorStore.search with filter
 *   - SqliteVectorStore.search with filter (skip under Bun)
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryVectorStore, matchesFilter } from '../src/memory/vector-index.js';
import { SqliteVectorStore } from '../src/memory/vector-sqlite.js';

const SKIP = typeof Bun !== 'undefined';

describe('matchesFilter — exact value', () => {
  test('matches when the value is strictly equal', () => {
    expect(matchesFilter({ source: 'email' }, { source: 'email' })).toBe(true);
  });
  test('rejects when the value differs', () => {
    expect(matchesFilter({ source: 'email' }, { source: 'slack' })).toBe(false);
  });
  test('rejects when the key is missing', () => {
    expect(matchesFilter({}, { source: 'email' })).toBe(false);
  });
  test('matches number and boolean values too', () => {
    expect(matchesFilter({ priority: 1, active: true }, { priority: 1, active: true })).toBe(true);
  });
});

describe('matchesFilter — $in operator', () => {
  test('matches when a scalar value is in the list (MongoDB-style)', () => {
    expect(matchesFilter({ source: 'email' }, { source: { $in: ['email', 'slack'] } })).toBe(true);
    expect(matchesFilter({ source: 'sms' }, { source: { $in: ['email', 'slack'] } })).toBe(false);
  });
  test('matches when the array has any intersection with the list', () => {
    expect(matchesFilter({ tags: ['a', 'b'] }, { tags: { $in: ['a', 'c'] } })).toBe(true);
    expect(matchesFilter({ tags: ['x', 'y'] }, { tags: { $in: ['a', 'c'] } })).toBe(false);
  });
});

describe('matchesFilter — $contains operator', () => {
  test('matches when the array contains the value', () => {
    expect(matchesFilter({ tags: ['urgent', 'customer'] }, { tags: { $contains: 'urgent' } })).toBe(
      true,
    );
  });
  test('rejects when the array does not contain the value', () => {
    expect(matchesFilter({ tags: ['low'] }, { tags: { $contains: 'urgent' } })).toBe(false);
  });
  test('matches substring when the value is a string', () => {
    expect(
      matchesFilter(
        { description: 'urgent customer request' },
        { description: { $contains: 'urgent' } },
      ),
    ).toBe(true);
  });
  test('rejects when the value is neither an array nor a string', () => {
    expect(matchesFilter({ count: 5 }, { count: { $contains: 'x' } })).toBe(false);
  });
});

describe('matchesFilter — $exists operator', () => {
  test('matches when the key is present', () => {
    expect(matchesFilter({ x: 1 }, { x: { $exists: true } })).toBe(true);
  });
  test('matches when the key is absent (and we wanted it absent)', () => {
    expect(matchesFilter({}, { x: { $exists: false } })).toBe(true);
  });
  test('rejects when the key is missing but we wanted it present', () => {
    expect(matchesFilter({}, { x: { $exists: true } })).toBe(false);
  });
});

describe('matchesFilter — multiple clauses', () => {
  test('ANDs multiple clauses together', () => {
    expect(
      matchesFilter({ source: 'email', priority: 'high' }, { source: 'email', priority: 'high' }),
    ).toBe(true);
    expect(
      matchesFilter({ source: 'email', priority: 'low' }, { source: 'email', priority: 'high' }),
    ).toBe(false);
  });

  test('mixes operators across clauses', () => {
    const filter = {
      source: { $in: ['email', 'slack'] },
      tags: { $contains: 'urgent' },
      active: true,
    };
    expect(
      matchesFilter({ source: 'email', tags: ['urgent', 'customer'], active: true }, filter),
    ).toBe(true);
    expect(matchesFilter({ source: 'sms', tags: ['urgent'], active: true }, filter)).toBe(false);
  });
});

describe('InMemoryVectorStore — search with filter', () => {
  test('filter narrows the result set', async () => {
    const store = new InMemoryVectorStore();
    await store.upsert({
      id: '1',
      content: 'a',
      embedding: [1, 0, 0],
      metadata: { source: 'email', priority: 'high' },
    });
    await store.upsert({
      id: '2',
      content: 'b',
      embedding: [0.9, 0.1, 0],
      metadata: { source: 'slack', priority: 'low' },
    });
    await store.upsert({
      id: '3',
      content: 'c',
      embedding: [0.8, 0.2, 0],
      metadata: { source: 'email', priority: 'low' },
    });

    const all = await store.search([1, 0, 0], 10);
    expect(all.length).toBe(3);

    const emails = await store.search([1, 0, 0], 10, { filter: { source: 'email' } });
    expect(emails.length).toBe(2);
    expect(emails.map((r) => r.id).sort()).toEqual(['1', '3']);

    const highPriority = await store.search([1, 0, 0], 10, { filter: { priority: 'high' } });
    expect(highPriority.length).toBe(1);
    expect(highPriority[0]?.id).toBe('1');

    const emailAndHigh = await store.search([1, 0, 0], 10, {
      filter: { source: 'email', priority: 'high' },
    });
    expect(emailAndHigh.length).toBe(1);
    expect(emailAndHigh[0]?.id).toBe('1');
  });

  test('preserves SearchResult.metadata on the result', async () => {
    const store = new InMemoryVectorStore();
    await store.upsert({
      id: '1',
      content: 'a',
      embedding: [1, 0, 0],
      metadata: { source: 'email', tags: ['urgent'] },
    });
    const results = await store.search([1, 0, 0], 5);
    expect(results[0]?.metadata).toEqual({ source: 'email', tags: ['urgent'] });
  });
});

describe.skipIf(SKIP)('SqliteVectorStore — search with filter', () => {
  let workDir: string;
  let dbPath: string;
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'husk-sqlite-filter-'));
    dbPath = join(workDir, 'vectors.db');
  });
  afterEach(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  test('filter narrows the result set + preserves metadata', async () => {
    const store = await SqliteVectorStore.open({ path: dbPath, dimension: 3 });
    await store.upsert({
      id: '1',
      content: 'a',
      embedding: [1, 0, 0],
      metadata: { source: 'email', priority: 'high' },
    });
    await store.upsert({
      id: '2',
      content: 'b',
      embedding: [0.9, 0.1, 0],
      metadata: { source: 'slack', priority: 'low' },
    });
    await store.upsert({
      id: '3',
      content: 'c',
      embedding: [0.8, 0.2, 0],
      metadata: { source: 'email', priority: 'low' },
    });

    const all = await store.search([1, 0, 0], 10);
    expect(all.length).toBe(3);

    const emails = await store.search([1, 0, 0], 10, { filter: { source: 'email' } });
    expect(emails.length).toBe(2);
    expect(emails.map((r) => r.id).sort()).toEqual(['1', '3']);

    const emailAndHigh = await store.search([1, 0, 0], 10, {
      filter: { source: 'email', priority: 'high' },
    });
    expect(emailAndHigh.length).toBe(1);
    expect(emailAndHigh[0]?.id).toBe('1');

    // metadata is preserved on the result
    expect(emailAndHigh[0]?.metadata).toEqual({ source: 'email', priority: 'high' });

    await store.close();
  });

  test('filter on the $in operator', async () => {
    const store = await SqliteVectorStore.open({ path: dbPath, dimension: 3 });
    await store.upsert({
      id: '1',
      content: 'a',
      embedding: [1, 0, 0],
      metadata: { source: 'email' },
    });
    await store.upsert({
      id: '2',
      content: 'b',
      embedding: [1, 0, 0],
      metadata: { source: 'slack' },
    });
    await store.upsert({
      id: '3',
      content: 'c',
      embedding: [1, 0, 0],
      metadata: { source: 'sms' },
    });

    const results = await store.search([1, 0, 0], 10, {
      filter: { source: { $in: ['email', 'slack'] } },
    });
    expect(results.length).toBe(2);
    expect(results.map((r) => r.id).sort()).toEqual(['1', '2']);

    await store.close();
  });
});
