/**
 * Husk — eval module barrel.
 *
 * Single import for the eval runner:
 *   import { defineSuite, runSuite, equals, contains, matches, fn } from '@princetheprogrammerbtw/husk';
 */

export {
  equals,
  contains,
  notContains,
  matches,
  fn,
  lengthBetween,
  defineSuite,
  runSuite,
  type Assertion,
  type AssertionResult,
  type EvalCase,
  type EvalSuite,
  type CaseResult,
  type SuiteResult,
  type AgentFactory,
  type RunSuiteOptions,
} from './runner.js';

// runner.ts re-exports the types; the type re-exports above are
// for callers that want everything from one place.
export type { Agent } from '../core/agent.js';
