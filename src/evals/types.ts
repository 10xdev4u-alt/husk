/**
 * Husk — eval runner types and API.
 *
 * The eval runner lets users assert that an agent's output meets
 * expectations. Three primitives:
 *
 *   1. EvalCase — an input + the expected outcome (an assertion or a set of them)
 *   2. Assertion — a function that takes the agent's result and returns pass/fail
 *   3. EvalSuite — a named collection of eval cases, runnable as a unit
 *
 * The design choice: assertions are plain async functions, not a DSL.
 * Users can use the 4 built-ins (equals, contains, matches, fn) or
 * write their own. The DSL is intentionally tiny — a heavy DSL
 * (think Jest matchers) is a maintainability trap.
 *
 * Example:
 *
 *   const suite = defineSuite({
 *     name: 'hello-agent',
 *     cases: [
 *       {
 *         name: 'answers geography',
 *         input: 'What is the capital of France? Answer in one word.',
 *         assertions: [
 *           contains('Paris'),
 *           matches(/^[A-Z][a-z]+$/),  // single capitalized word
 *         ],
 *       },
 *     ],
 *   });
 *
 *   const results = await runSuite(suite, () => new Agent({ model: ... }));
 *   console.log(`${results.passed}/${results.total} passed`);
 */

import type { AgentResult } from '../core/types.js';

// ───────────────────────────────────────────────────────────────────
// Assertions
// ───────────────────────────────────────────────────────────────────

/**
 * A function that checks whether an agent's output meets a criterion.
 * Returns a pass/fail with an optional message explaining the failure.
 */
export type Assertion = (result: AgentResult) => AssertionResult | Promise<AssertionResult>;

export interface AssertionResult {
  /** Whether the assertion passed. */
  readonly pass: boolean;
  /** Human-readable name shown in eval reports. */
  readonly name: string;
  /** Optional message — required when pass is false to explain why. */
  readonly message?: string;
}

// ───────────────────────────────────────────────────────────────────
// Built-in assertions
// ───────────────────────────────────────────────────────────────────

/** Output exactly equals the expected string. */
export function equals(expected: string): Assertion {
  return (result) => {
    const pass = result.output === expected;
    return pass
      ? { name: `equals(${JSON.stringify(expected).slice(0, 40)})`, pass: true }
      : {
          name: `equals(${JSON.stringify(expected).slice(0, 40)})`,
          pass: false,
          message: `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(result.output).slice(0, 200)}`,
        };
  };
}

/** Output contains the expected substring (case-sensitive). */
export function contains(needle: string): Assertion {
  return (result) => {
    const pass = result.output.includes(needle);
    return pass
      ? { name: `contains(${JSON.stringify(needle).slice(0, 40)})`, pass: true }
      : {
          name: `contains(${JSON.stringify(needle).slice(0, 40)})`,
          pass: false,
          message: `Expected output to contain ${JSON.stringify(needle)}, got ${JSON.stringify(result.output).slice(0, 200)}`,
        };
  };
}

/** Output matches the expected regex. */
export function matches(pattern: RegExp): Assertion {
  return (result) => {
    const m = pattern.exec(result.output);
    return {
      name: `matches(${pattern})`,
      pass: m !== null,
      ...(m === null
        ? {
            message: `Output did not match ${pattern}: ${JSON.stringify(result.output).slice(0, 200)}`,
          }
        : {}),
    };
  };
}

/** Output passes a custom predicate. Use this for shape-based checks. */
export function fn(
  name: string,
  predicate: (output: string) => boolean,
  message?: string,
): Assertion {
  return (result) => {
    const pass = predicate(result.output);
    return {
      name,
      pass,
      ...(pass ? {} : { message: message ?? `Predicate ${name} failed` }),
    };
  };
}

/** Output does NOT contain the given substring. */
export function notContains(needle: string): Assertion {
  return (result) => {
    const pass = !result.output.includes(needle);
    return pass
      ? { name: `notContains(${JSON.stringify(needle).slice(0, 40)})`, pass: true }
      : {
          name: `notContains(${JSON.stringify(needle).slice(0, 40)})`,
          pass: false,
          message: `Output should not contain ${JSON.stringify(needle)} but did: ${JSON.stringify(result.output).slice(0, 200)}`,
        };
  };
}

/** Output length is within bounds. */
export function lengthBetween(min: number, max: number): Assertion {
  return (result) => {
    const len = result.output.length;
    const pass = len >= min && len <= max;
    return pass
      ? { name: `lengthBetween(${min}, ${max})`, pass: true }
      : {
          name: `lengthBetween(${min}, ${max})`,
          pass: false,
          message: `Output length ${len} not in [${min}, ${max}]`,
        };
  };
}

// ───────────────────────────────────────────────────────────────────
// Eval cases & suites
// ───────────────────────────────────────────────────────────────────

export interface EvalCase {
  /** Human-readable name shown in eval reports. */
  readonly name: string;
  /** The input to pass to agent.run(). */
  readonly input: string;
  /** Assertions to run on the result. All must pass for the case to pass. */
  readonly assertions: readonly Assertion[];
  /**
   * Optional max iterations override. Lets you cap runaway agents per-case
   * without affecting other cases in the suite.
   */
  readonly maxIterations?: number;
}

export interface EvalSuite {
  /** Suite name shown in reports. */
  readonly name: string;
  /** Cases in this suite, run sequentially. */
  readonly cases: readonly EvalCase[];
}

// ───────────────────────────────────────────────────────────────────
// Suite results
// ───────────────────────────────────────────────────────────────────

export interface CaseResult {
  readonly caseName: string;
  readonly passed: boolean;
  readonly assertionResults: readonly AssertionResult[];
  readonly agentResult: AgentResult;
  readonly durationMs: number;
}

export interface SuiteResult {
  readonly suiteName: string;
  readonly results: readonly CaseResult[];
  readonly passed: number;
  readonly total: number;
  readonly durationMs: number;
}
