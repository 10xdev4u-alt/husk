/**
 * Example 03 — Multi-Agent Orchestrator.
 *
 * Three Husk agents composed together:
 *   1. Planner  — no file tools, just reasons about a task and produces a plan
 *   2. Coder    — has all 5 file tools, executes the plan
 *   3. Reviewer — has Read+Grep, inspects the coder's output
 *
 * The orchestrator is a plain async function that calls the agents
 * sequentially. We could put the orchestrator inside its own Agent,
 * but for v0.1.0 a plain function is clearer to read.
 *
 * Run: bun run examples/03-multi-agent/index.ts
 */

import { Agent, AnthropicProvider, Bash, Edit, Grep, Read, Write } from '../../src/index.js';

const model = new AnthropicProvider({ model: 'claude-opus-4-6' });

// ── Agent 1: Planner ─────────────────────────────────────────────
const planner = new Agent({
  model,
  steering: {
    systemPrompt:
      'You are a senior engineer. Given a task, produce a short numbered plan (2-4 steps). Each step should be small enough for another agent to execute in one tool call or one short script.',
    rules: [
      'Output ONLY the numbered plan, no preamble.',
      'Each step must be self-contained: a coder with no other context should be able to execute it.',
    ],
  },
  maxIterations: 1,
});

// ── Agent 2: Coder ───────────────────────────────────────────────
const coder = new Agent({
  model,
  tools: [Read, Write, Edit, Bash, Grep],
  steering: {
    systemPrompt:
      'You are a careful implementer. Execute the given step exactly. If something is unclear, prefer the simplest interpretation and document your assumption in a code comment.',
  },
  maxIterations: 20,
});

// ── Agent 3: Reviewer ────────────────────────────────────────────
const reviewer = new Agent({
  model,
  tools: [Read, Grep],
  steering: {
    systemPrompt:
      'You are a strict code reviewer. Inspect what was written. Report bugs, security issues, or style problems. If the code is correct and clean, say "LGTM" and stop.',
    rules: [
      'Read the file fully before commenting.',
      'Cite specific line numbers for every finding.',
    ],
  },
  maxIterations: 10,
});

// ── Orchestrator ─────────────────────────────────────────────────
const TASK =
  'Create a small TypeScript utility at examples/03-multi-agent/greet.ts that exports a function greet(name: string): string returning "Hello, {name}!" with proper JSDoc.';

async function orchestrate(task: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`\n=== TASK ===\n${task}\n`);

  // Step 1: plan
  // eslint-disable-next-line no-console
  console.log('--- Phase 1: Planning ---');
  const planResult = await planner.run(task);
  const plan = planResult.output;
  // eslint-disable-next-line no-console
  console.log(`\nPlan:\n${plan}\n`);

  // Step 2: execute (single-step plan, but the pattern scales to N)
  // eslint-disable-next-line no-console
  console.log('--- Phase 2: Coding ---');
  const codeResult = await coder.run(`Execute this plan:\n\n${plan}\n\nTask: ${task}`);
  // eslint-disable-next-line no-console
  console.log(`\nCoder output:\n${codeResult.output}\n`);

  // Step 3: review
  // eslint-disable-next-line no-console
  console.log('--- Phase 3: Review ---');
  const reviewResult = await reviewer.run(
    `Review the file at examples/03-multi-agent/greet.ts. Confirm it implements: ${task}`,
  );
  // eslint-disable-next-line no-console
  console.log(`\nReviewer output:\n${reviewResult.output}\n`);

  // Stats
  const total = {
    iterations: planResult.iterations + codeResult.iterations + reviewResult.iterations,
    tokens:
      planResult.usage.inputTokens +
      planResult.usage.outputTokens +
      codeResult.usage.inputTokens +
      codeResult.usage.outputTokens +
      reviewResult.usage.inputTokens +
      reviewResult.usage.outputTokens,
  };
  // eslint-disable-next-line no-console
  console.log(`=== Done. ${total.iterations} iterations, ${total.tokens} tokens total. ===`);
}

await orchestrate(TASK);
