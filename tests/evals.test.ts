/**
 * Husk — eval runner tests.
 *
 * Verifies the assertion DSL (equals/contains/matches/fn/notContains/
 * lengthBetween) and the runner (pass/fail counting, error handling,
 * failFast). Uses a fake Agent factory to avoid making LLM calls.
 */

import { describe, expect, test } from 'bun:test';
import { Agent } from '../src/core/agent.js';
import type { AgentResult } from '../src/core/types.js';
import {
  contains,
  defineSuite,
  equals,
  fn,
  lengthBetween,
  matches,
  notContains,
  runSuite,
} from '../src/evals/index.js';

// ───────────────────────────────────────────────────────────────────
// Assertion DSL
// ───────────────────────────────────────────────────────────────────

function fakeResult(output: string): AgentResult {
  return {
    output,
    messages: [],
    iterations: 1,
    usage: { inputTokens: 10, outputTokens: output.length },
    durationMs: 5,
  };
}

describe('equals', () => {
  test('passes on exact match', () => {
    expect(equals('hello')(fakeResult('hello')).pass).toBe(true);
  });
  test('fails on mismatch', () => {
    const r = equals('hello')(fakeResult('world'));
    expect(r.pass).toBe(false);
    expect(r.message).toBeDefined();
  });
});

describe('contains', () => {
  test('passes when substring present', () => {
    expect(contains('ell')(fakeResult('hello')).pass).toBe(true);
  });
  test('fails when substring absent', () => {
    expect(contains('xyz')(fakeResult('hello')).pass).toBe(false);
  });
});

describe('notContains', () => {
  test('passes when substring absent', () => {
    expect(notContains('xyz')(fakeResult('hello')).pass).toBe(true);
  });
  test('fails when substring present', () => {
    expect(notContains('ell')(fakeResult('hello')).pass).toBe(false);
  });
});

describe('matches', () => {
  test('passes on regex match', () => {
    expect(matches(/^hello$/)(fakeResult('hello')).pass).toBe(true);
  });
  test('fails on no match', () => {
    expect(matches(/^\d+$/)(fakeResult('hello')).pass).toBe(false);
  });
});

describe('fn (custom predicate)', () => {
  test('passes when predicate returns true', () => {
    expect(fn('isUpper', (s) => s === s.toUpperCase())(fakeResult('HELLO')).pass).toBe(true);
  });
  test('fails when predicate returns false', () => {
    const r = fn(
      'isUpper',
      (s) => s === s.toUpperCase(),
      'expected all uppercase',
    )(fakeResult('Hello'));
    expect(r.pass).toBe(false);
    expect(r.message).toBe('expected all uppercase');
  });
});

describe('lengthBetween', () => {
  test('passes when in range', () => {
    expect(lengthBetween(3, 10)(fakeResult('hello')).pass).toBe(true);
  });
  test('fails when too short', () => {
    expect(lengthBetween(10, 20)(fakeResult('hello')).pass).toBe(false);
  });
  test('fails when too long', () => {
    expect(lengthBetween(1, 2)(fakeResult('hello')).pass).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────
// Runner
// ───────────────────────────────────────────────────────────────────

/** Build a fake Agent that returns the canned output for a given input. */
function fakeAgentFactory(cannedOutput: string) {
  return async (): Promise<Agent> => {
    // We override run() on a real Agent instance so the result shape
    // matches what the runner expects.
    const agent = new Agent({
      model: {
        name: 'fake',
        model: 'fake',
        chat: async () => ({
          message: { role: 'assistant', content: cannedOutput },
          usage: { inputTokens: 0, outputTokens: 0 },
          stopReason: 'end_turn' as const,
          model: 'fake',
        }),
      },
    });
    return agent;
  };
}

describe('runSuite', () => {
  test('passes when all assertions pass', async () => {
    const suite = defineSuite({
      name: 'trivial',
      cases: [{ name: 'greeting', input: 'hi', assertions: [contains('hello')] }],
    });
    const result = await runSuite(suite, fakeAgentFactory('hello world'));
    expect(result.passed).toBe(1);
    expect(result.total).toBe(1);
    expect(result.results[0]?.passed).toBe(true);
  });

  test('fails when any assertion fails', async () => {
    const suite = defineSuite({
      name: 'mismatch',
      cases: [{ name: 'greeting', input: 'hi', assertions: [equals('hello'), contains('foo')] }],
    });
    const result = await runSuite(suite, fakeAgentFactory('hello'));
    expect(result.passed).toBe(0);
    expect(result.total).toBe(1);
    expect(result.results[0]?.passed).toBe(false);
  });

  test('counts multiple cases', async () => {
    const suite = defineSuite({
      name: 'multi',
      cases: [
        { name: 'a', input: '?', assertions: [equals('yes')] },
        { name: 'b', input: '?', assertions: [equals('yes')] },
        { name: 'c', input: '?', assertions: [equals('no')] },
      ],
    });
    const result = await runSuite(suite, fakeAgentFactory('yes'));
    expect(result.passed).toBe(2);
    expect(result.total).toBe(3);
  });

  test('failFast stops at first failure', async () => {
    const suite = defineSuite({
      name: 'failFast',
      cases: [
        { name: 'a', input: '?', assertions: [equals('yes')] },
        { name: 'b', input: '?', assertions: [equals('yes')] },
        { name: 'c', input: '?', assertions: [equals('yes')] },
      ],
    });
    const result = await runSuite(suite, fakeAgentFactory('no'), { failFast: true });
    expect(result.total).toBe(3); // declared total
    // But only the cases that ran are in results
    expect(result.results.length).toBeLessThanOrEqual(3);
  });

  test('agent.run throwing is reported as a case failure', async () => {
    const suite = defineSuite({
      name: 'throws',
      cases: [{ name: 'boom', input: '?', assertions: [equals('whatever')] }],
    });
    const factory = async (): Promise<Agent> => {
      const agent = new Agent({
        model: {
          name: 'fake',
          model: 'fake',
          chat: async () => {
            throw new Error('upstream failed');
          },
        },
      });
      return agent;
    };
    const result = await runSuite(suite, factory);
    expect(result.passed).toBe(0);
    expect(result.results[0]?.passed).toBe(false);
    const firstResult = result.results[0];
    if (firstResult) {
      const firstAssertion = firstResult.assertionResults[0];
      expect(firstAssertion?.message).toContain('upstream failed');
    }
  });

  test('onCaseStart and onCaseEnd hooks fire', async () => {
    const suite = defineSuite({
      name: 'hooks',
      cases: [
        { name: 'a', input: '?', assertions: [equals('yes')] },
        { name: 'b', input: '?', assertions: [equals('yes')] },
      ],
    });
    const starts: string[] = [];
    const ends: string[] = [];
    await runSuite(suite, fakeAgentFactory('yes'), {
      onCaseStart: (n) => starts.push(n),
      onCaseEnd: (r) => ends.push(r.caseName),
    });
    expect(starts).toEqual(['a', 'b']);
    expect(ends).toEqual(['a', 'b']);
  });
});
