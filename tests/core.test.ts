/**
 * Husk — core unit tests.
 *
 * These tests don't make any LLM calls — they verify the pure logic
 * that backs the agent loop: memory stores, steering builders, schema
 * validation, and the event emitter. Run with `bun test`.
 *
 * Provider adapter tests live in tests/providers/ and use mocked
 * fetch to avoid real API calls. End-to-end tests (real API) are
 * intentionally out of scope for v0.1.0; they belong in CI with a
 * proper secrets store.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentEventEmitter,
  FileStore,
  InMemoryStore,
  type Message,
  buildExampleMessages,
  buildSystemPrompt,
} from '../src/index.js';

describe('InMemoryStore', () => {
  test('read on empty store returns empty array', async () => {
    const store = new InMemoryStore();
    expect(await store.read('s1')).toEqual([]);
  });

  test('append then read returns the message', async () => {
    const store = new InMemoryStore();
    const m: Message = { role: 'user', content: 'hello' };
    await store.append('s1', m);
    expect(await store.read('s1')).toEqual([m]);
  });

  test('clear removes the session', async () => {
    const store = new InMemoryStore();
    await store.append('s1', { role: 'user', content: 'x' });
    await store.clear('s1');
    expect(await store.read('s1')).toEqual([]);
  });

  test('sessions are isolated', async () => {
    const store = new InMemoryStore();
    await store.append('s1', { role: 'user', content: 'one' });
    await store.append('s2', { role: 'user', content: 'two' });
    expect(await store.read('s1')).toEqual([{ role: 'user', content: 'one' }]);
    expect(await store.read('s2')).toEqual([{ role: 'user', content: 'two' }]);
  });

  test('listSessions returns all known session ids', async () => {
    const store = new InMemoryStore();
    await store.append('alpha', { role: 'user', content: 'a' });
    await store.append('beta', { role: 'user', content: 'b' });
    const ids = await store.listSessions();
    expect(ids.sort()).toEqual(['alpha', 'beta']);
  });
});

describe('FileStore', () => {
  test('persists across instances', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'husk-test-'));
    try {
      const a = new FileStore({ path: dir });
      const m: Message = { role: 'assistant', content: 'persisted' };
      await a.append('s1', m);

      const b = new FileStore({ path: dir });
      const read = await b.read('s1');
      expect(read).toEqual([m]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('read on missing file returns empty array', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'husk-test-'));
    try {
      const store = new FileStore({ path: dir });
      expect(await store.read('does-not-exist')).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('survives a malformed line in the file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'husk-test-'));
    try {
      // Write a corrupted line by hand.
      const file = join(dir, 's1.jsonl');
      await writeFile(
        file,
        `${JSON.stringify({ message: { role: 'user', content: 'good' } })}\nthis is not json\n${JSON.stringify({ message: { role: 'user', content: 'also good' } })}\n`,
        'utf-8',
      );
      const store = new FileStore({ path: dir });
      const messages = await store.read('s1');
      expect(messages.length).toBe(2);
      expect(messages[0]?.content).toBe('good');
      expect(messages[1]?.content).toBe('also good');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('listSessions scans the directory for .jsonl files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'husk-test-'));
    try {
      const store = new FileStore({ path: dir });
      await store.append('alpha', { role: 'user', content: 'a' });
      await store.append('beta', { role: 'user', content: 'b' });
      const ids = (await store.listSessions()).sort();
      expect(ids).toEqual(['alpha', 'beta']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('buildSystemPrompt', () => {
  test('returns undefined when no system prompt and no rules', () => {
    expect(buildSystemPrompt({})).toBeUndefined();
  });

  test('returns systemPrompt when only it is set', () => {
    expect(buildSystemPrompt({ systemPrompt: 'You are helpful.' })).toBe('You are helpful.');
  });

  test('numbers rules when present', () => {
    const result = buildSystemPrompt({
      systemPrompt: 'Base prompt.',
      rules: ['Be concise.', 'Cite sources.'],
    });
    expect(result).toContain('Base prompt.');
    expect(result).toContain('## Rules');
    expect(result).toContain('1. Be concise.');
    expect(result).toContain('2. Cite sources.');
  });

  test('trims whitespace on the system prompt', () => {
    expect(buildSystemPrompt({ systemPrompt: '  hello  ' })).toBe('hello');
  });
});

describe('buildExampleMessages', () => {
  test('emits user/assistant pairs in order', () => {
    const result = buildExampleMessages([
      { user: 'Q1', assistant: 'A1' },
      { user: 'Q2', assistant: 'A2' },
    ]);
    expect(result).toEqual([
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'Q2' },
      { role: 'assistant', content: 'A2' },
    ]);
  });

  test('returns empty array for empty examples', () => {
    expect(buildExampleMessages([])).toEqual([]);
  });
});

describe('AgentEventEmitter', () => {
  test('typed handlers receive only matching events', async () => {
    const emitter = new AgentEventEmitter();
    const received: number[] = [];
    emitter.on('agent:iteration', (e) => {
      received.push(e.iteration);
    });
    await emitter.emit({ type: 'agent:start', input: 'x', sessionId: 's' });
    await emitter.emit({ type: 'agent:iteration', iteration: 1 });
    await emitter.emit({ type: 'agent:iteration', iteration: 2 });
    expect(received).toEqual([1, 2]);
  });

  test('onAny receives every event', async () => {
    const emitter = new AgentEventEmitter();
    const types: string[] = [];
    emitter.onAny((e) => {
      types.push(e.type);
    });
    await emitter.emit({ type: 'agent:start', input: 'x', sessionId: 's' });
    await emitter.emit({ type: 'agent:end', output: 'y', iterations: 1, durationMs: 10 });
    expect(types).toEqual(['agent:start', 'agent:end']);
  });

  test('unsubscribe stops further delivery', async () => {
    const emitter = new AgentEventEmitter();
    let count = 0;
    const off = emitter.on('agent:start', () => {
      count += 1;
    });
    await emitter.emit({ type: 'agent:start', input: 'x', sessionId: 's' });
    off();
    await emitter.emit({ type: 'agent:start', input: 'x', sessionId: 's' });
    expect(count).toBe(1);
  });

  test('a throwing handler does not crash emit or block others', async () => {
    const emitter = new AgentEventEmitter();
    let after = 0;
    emitter.on('agent:start', () => {
      throw new Error('boom');
    });
    emitter.on('agent:start', () => {
      after += 1;
    });
    // Should not throw, and the second handler should still run.
    await emitter.emit({ type: 'agent:start', input: 'x', sessionId: 's' });
    expect(after).toBe(1);
  });
});
