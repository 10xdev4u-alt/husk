# Example 04 — Eval Suite

Demonstrates Husk's eval runner with a tiny suite that asserts
the hello-agent's output for a geography question. No API key
required — uses a canned-output fake agent.

For real evals, swap the `agentFactory` for one that wires a
real provider (Anthropic, OpenAI, Ollama).

## Run it

```bash
bun run examples/04-evals/index.ts
```

You should see:

```
=== hello-agent-evals ===
  ✓ knows the capital of France
  ✓ answers in one sentence
=== 2/2 passed in 12ms ===
```

## What this demonstrates

- `defineSuite()` to declare a named collection of cases
- Built-in assertions: `contains()`, `equals()`, `notContains()`, `lengthBetween()`
- `runSuite()` returns a `SuiteResult` with pass/total counts and per-case details
- A fake `AgentFactory` that returns canned output (no LLM call)
- Multiple assertions per case (all must pass)

## Real-world usage

Swap the factory for a real agent and run as a CI step:

```ts
import { AnthropicProvider } from '@princetheprogrammerbtw/husk';

const factory = () => new Agent({
  model: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
});

const result = await runSuite(geography, factory);
if (result.passed < result.total) process.exit(1);
```

For a real CI integration, see `husk eval <file-or-dir>` (planned for v0.3.0).
