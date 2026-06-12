/**
 * Example 02 — Code Reviewer.
 *
 * A Husk agent that uses the 5 built-in tools and a steering config
 * to behave like a strict, security-conscious code reviewer. Reviews
 * a target file, prints findings, and (optionally) suggests edits.
 *
 * Run: bun run examples/02-code-reviewer/index.ts
 */

import {
  Agent,
  type AgentEvent,
  AnthropicProvider,
  Bash,
  Edit,
  FileStore,
  Grep,
  InMemoryStore,
  Read,
  Write,
} from '../../src/index.js';

const TARGET_FILE = 'src/core/agent.ts';
const MEMORY_BACKEND: 'in-memory' | 'file' = 'in-memory';

const STEERING = {
  systemPrompt:
    'You are a meticulous senior engineer performing a code review. Be specific, cite line numbers, and prefer concrete fixes over vague advice. If you find no issues, say so explicitly rather than inventing concerns.',
  rules: [
    'Always read the file in full before commenting on it.',
    'For each finding, cite the specific line number and quote the offending code.',
    'Prioritize security issues (input validation, injection, secrets in code) and correctness bugs (off-by-one, null/undefined, race conditions).',
    'Style and naming are out of scope unless they obscure meaning.',
    'If you propose a fix, include the exact replacement code — do not just describe the change.',
  ],
  examples: [
    {
      user: 'Review src/core/memory.ts',
      assistant:
        'I read the file. Two findings:\n\n1. Line 84 — writeLocks stores promises that may grow unbounded if sessions are not cleared. Suggest a WeakRef or periodic cleanup.\n\n2. Line 130 — the JSON.parse in a try/catch silently swallows malformed lines. This hides data corruption; suggest logging instead.',
    },
  ],
};

const agent = new Agent({
  model: new AnthropicProvider({ model: 'claude-opus-4-6' }),
  tools: [Read, Write, Edit, Bash, Grep],
  memory:
    MEMORY_BACKEND === 'file' ? new FileStore({ path: './.husk/memory' }) : new InMemoryStore(),
  steering: STEERING,
  maxIterations: 15,
});

// Pretty-print what the agent is doing as it works.
agent.on('tool:call', (event) => {
  // eslint-disable-next-line no-console
  console.log(`\n→ tool: ${event.name}(${JSON.stringify(event.input).slice(0, 200)})`);
});
agent.on('tool:result', (event) => {
  const snippet = typeof event.result.output === 'string' ? event.result.output : '<blocks>';
  // eslint-disable-next-line no-console
  console.log(
    `  ← ${event.durationMs}ms, ${snippet.length} chars${event.result.isError ? ' (ERROR)' : ''}`,
  );
});
agent.on('agent:iteration', (event: AgentEvent) => {
  if (event.type === 'agent:iteration') {
    // eslint-disable-next-line no-console
    console.log(`\n--- iteration ${event.iteration} ---`);
  }
});

const result = await agent.run(
  `Please review the file at ${TARGET_FILE}. Read it first, then list concrete findings with line numbers. End with "Review complete" when done.`,
);

// eslint-disable-next-line no-console
console.log('\n=== FINAL REVIEW ===\n');
// eslint-disable-next-line no-console
console.log(result.output);
// eslint-disable-next-line no-console
console.log(
  `\n=== Stats: ${result.iterations} iterations, ${result.usage.inputTokens + result.usage.outputTokens} total tokens, ${result.durationMs}ms ===`,
);
