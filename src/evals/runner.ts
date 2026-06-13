/**
 * Husk — eval runner.
 *
 * Takes an EvalSuite + a factory that returns an Agent, runs each
 * case sequentially, applies the assertions, and reports results.
 *
 * Why a factory (not an Agent instance): each case might want its
 * own agent configuration. The factory pattern gives the user full
 * control without forcing a specific shape.
 *
 * Why sequential (not parallel): LLM calls compete for rate limits
 * and cost $$$. Sequential gives predictable billing and easier
 * debugging. Parallel mode is a v0.3.0 addition.
 *
 * Failure handling: an agent run that throws an error is reported
 * as a case failure (not a runner crash). The error message is
 * included in the assertion results so the user can see what broke.
 */

import type { Agent } from '../core/agent.js';
import type { AgentResult } from '../core/types.js';
import type {
  Assertion,
  AssertionResult,
  CaseResult,
  EvalCase,
  EvalSuite,
  SuiteResult,
} from './types.js';

// Re-export the assertion builders + types from types.ts so callers
// can import everything from this single file.
export {
  equals,
  contains,
  notContains,
  matches,
  fn,
  lengthBetween,
} from './types.js';
export type { Assertion, AssertionResult, EvalCase, EvalSuite, CaseResult, SuiteResult };

// ───────────────────────────────────────────────────────────────────
// Runner
// ───────────────────────────────────────────────────────────────────

/**
 * A factory that produces a fresh Agent per case. Called once per
 * case so each case can have isolated memory, config, etc.
 */
export type AgentFactory = () => Agent | Promise<Agent>;

export interface RunSuiteOptions {
  /** Stop on first failing case. Default: false (run all cases regardless). */
  readonly failFast?: boolean;
  /** Custom logger for runner-level events. Default: silent. */
  readonly onCaseStart?: (caseName: string) => void;
  readonly onCaseEnd?: (result: CaseResult) => void;
}

export async function runSuite(
  suite: EvalSuite,
  factory: AgentFactory,
  options: RunSuiteOptions = {},
): Promise<SuiteResult> {
  const start = Date.now();
  const results: CaseResult[] = [];
  let passed = 0;

  for (const c of suite.cases) {
    options.onCaseStart?.(c.name);
    const caseResult = await runCase(c, factory);
    results.push(caseResult);
    if (caseResult.passed) passed += 1;
    options.onCaseEnd?.(caseResult);

    if (options.failFast && !caseResult.passed) {
      break;
    }
  }

  return {
    suiteName: suite.name,
    results,
    passed,
    total: suite.cases.length,
    durationMs: Date.now() - start,
  };
}

// ───────────────────────────────────────────────────────────────────
// Case runner
// ───────────────────────────────────────────────────────────────────

async function runCase(c: EvalCase, factory: AgentFactory): Promise<CaseResult> {
  const start = Date.now();
  const agent = await factory();

  let agentResult: AgentResult;
  try {
    agentResult = await agent.run(c.input);
  } catch (err) {
    // Agent threw — synthesize a result so the case still reports.
    const message = err instanceof Error ? err.message : String(err);
    const errorAssertionResult = {
      pass: false,
      name: 'agent.run',
      message: `agent.run threw: ${message}`,
    };
    return {
      caseName: c.name,
      passed: false,
      assertionResults: [errorAssertionResult],
      agentResult: {
        output: '',
        messages: [],
        iterations: 0,
        usage: { inputTokens: 0, outputTokens: 0 },
        durationMs: Date.now() - start,
      },
      durationMs: Date.now() - start,
    };
  }

  const assertionResults: { pass: boolean; name: string; message?: string }[] = [];
  for (const a of c.assertions) {
    const r = await a(agentResult);
    assertionResults.push(r);
  }

  const allPassed = assertionResults.every((r) => r.pass);
  return {
    caseName: c.name,
    passed: allPassed,
    assertionResults,
    agentResult,
    durationMs: Date.now() - start,
  };
}

// ───────────────────────────────────────────────────────────────────
// Suite definition helper
// ───────────────────────────────────────────────────────────────────

/**
 * Build a suite with less boilerplate. Equivalent to constructing
 * the object inline, but reads more clearly at the call site.
 */
export function defineSuite(suite: { name: string; cases: readonly EvalCase[] }): EvalSuite {
  return {
    name: suite.name,
    cases: suite.cases,
  };
}

// Re-export Assertion and AssertionResult for callers that want to
// type their custom assertion functions.
// (Already re-exported at the top of the file.)
