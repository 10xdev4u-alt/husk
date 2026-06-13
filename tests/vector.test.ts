/**
 * Husk — vector memory tests.
 *
 * Verifies the InMemoryVectorStore (CRUD + similarity), HashEmbedder
 * (deterministic, normalized), and the MemorySearch/Remember tools
 * (search returns expected items, remember stores items correctly).
 */

import { describe, expect, test } from 'bun:test';
import {
  HashEmbedder,
  InMemoryVectorStore,
  cosineSimilarity,
  defineMemorySearchTool,
  defineRememberTool,
} from '../src/index.js';

describe('cosineSimilarity', () => {
  test('returns 1.0 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
  });
  test('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 5);
  });
  test('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1, 5);
  });
  test('returns 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0, 0], [0, 0, 0])).toBe(0);
  });
  test('throws on dimension mismatch', () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow();
  });
});

describe('InMemoryVectorStore', () => {
  test('upsert + search finds the right item', async () => {
    const store = new InMemoryVectorStore();
    await store.upsert({
      id: 'a',
      content: 'apple',
      embedding: [1, 0, 0],
    });
    await store.upsert({
      id: 'b',
      content: 'banana',
      embedding: [0, 1, 0],
    });
    const results = await store.search([1, 0, 0], 1);
    expect(results.length).toBe(1);
    expect(results[0]?.id).toBe('a');
    expect(results[0]?.score).toBeCloseTo(1, 5);
  });

  test('search returns top-K by score', async () => {
    const store = new InMemoryVectorStore();
    await store.upsert({ id: 'a', content: 'a', embedding: [1, 0, 0] });
    await store.upsert({ id: 'b', content: 'b', embedding: [0.9, 0.1, 0] });
    await store.upsert({ id: 'c', content: 'c', embedding: [0, 1, 0] });
    const results = await store.search([1, 0, 0], 2);
    expect(results.map((r) => r.id)).toEqual(['a', 'b']);
  });

  test('empty store returns empty results', async () => {
    const store = new InMemoryVectorStore();
    const results = await store.search([1, 0, 0], 5);
    expect(results).toEqual([]);
  });

  test('remove deletes the item', async () => {
    const store = new InMemoryVectorStore();
    await store.upsert({ id: 'a', content: 'a', embedding: [1, 0, 0] });
    expect(await store.count()).toBe(1);
    await store.remove('a');
    expect(await store.count()).toBe(0);
  });

  test('list returns all ids', async () => {
    const store = new InMemoryVectorStore();
    await store.upsert({ id: 'x', content: 'x', embedding: [1, 0] });
    await store.upsert({ id: 'y', content: 'y', embedding: [0, 1] });
    expect((await store.list()).sort()).toEqual(['x', 'y']);
  });

  test('clear empties the store', async () => {
    const store = new InMemoryVectorStore();
    await store.upsert({ id: 'a', content: 'a', embedding: [1, 0] });
    await store.clear();
    expect(await store.count()).toBe(0);
  });
});

describe('HashEmbedder', () => {
  test('produces vectors of the configured dimension', async () => {
    const e = new HashEmbedder({ dimensions: 64 });
    const v = await e.embed('hello world');
    expect(v.length).toBe(64);
  });

  test('is deterministic — same input → same output', async () => {
    const e = new HashEmbedder();
    const a = await e.embed('the quick brown fox');
    const b = await e.embed('the quick brown fox');
    expect(a).toEqual(b);
  });

  test('similar inputs produce similar vectors (bag-of-chars)', async () => {
    const e = new HashEmbedder();
    const a = await e.embed('the cat sat on the mat');
    const b = await e.embed('the cat sat on a mat');
    const c = await e.embed('quantum entanglement photon');
    expect(cosineSimilarity(a, b)).toBeGreaterThan(cosineSimilarity(a, c));
  });

  test('vectors are L2-normalized (unit norm)', async () => {
    const e = new HashEmbedder();
    const v = await e.embed('some text to embed');
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  test('empty string produces a zero vector', async () => {
    const e = new HashEmbedder();
    const v = await e.embed('');
    expect(v.every((x) => x === 0)).toBe(true);
  });
});

describe('MemorySearch tool', () => {
  test('returns top-K most similar items with scores', async () => {
    const store = new InMemoryVectorStore();
    const embedder = new HashEmbedder();
    // Pre-seed: store two items, embed them via the same embedder
    const e1 = await embedder.embed('user likes dark mode');
    const e2 = await embedder.embed('user prefers vim keybindings');
    await store.upsert({ id: 'pref-1', content: 'user likes dark mode', embedding: e1 });
    await store.upsert({ id: 'pref-2', content: 'user prefers vim keybindings', embedding: e2 });

    const tool = defineMemorySearchTool({ store, embedder });
    const result = await tool.execute({ query: 'dark mode preference' });
    if (!result || typeof result === 'string') throw new Error('expected ToolResult');
    expect(result.isError).toBeFalsy();
    // The output contains the matched content with its score; the
    // most similar item should rank first.
    expect(result.output).toContain('user likes dark mode');
    expect(result.output).toContain('score=');
    // Most-similar should be the dark mode one, not the vim one.
    const darkIdx = result.output.indexOf('dark mode');
    const vimIdx = result.output.indexOf('vim');
    expect(darkIdx).toBeLessThan(vimIdx);
    expect(darkIdx).toBeGreaterThanOrEqual(0);
  });

  test('returns "No matching memories found" for empty store', async () => {
    const store = new InMemoryVectorStore();
    const embedder = new HashEmbedder();
    const tool = defineMemorySearchTool({ store, embedder });
    const result = await tool.execute({ query: 'anything' });
    if (!result || typeof result === 'string') throw new Error('expected ToolResult');
    expect(result.output).toBe('No matching memories found.');
  });
});

describe('Remember tool', () => {
  test('upserts an item that becomes searchable', async () => {
    const store = new InMemoryVectorStore();
    const embedder = new HashEmbedder();
    const remember = defineRememberTool({ store, embedder });
    const search = defineMemorySearchTool({ store, embedder });

    const r = await remember.execute({ id: 'test-1', content: 'the project uses bun' });
    if (!r || typeof r === 'string') throw new Error('expected ToolResult');
    expect(r.output).toContain('the project uses bun');

    const s = await search.execute({ query: 'what runtime does the project use' });
    if (!s || typeof s === 'string') throw new Error('expected ToolResult');
    expect(s.output).toContain('the project uses bun');
  });
});
