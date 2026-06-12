# Example 02 — Code Reviewer

A Husk agent with all 5 built-in tools and a steering config that
shapes it into a strict, security-conscious code reviewer.

## Run it

```bash
export ANTHROPIC_API_KEY=sk-...
bun run examples/02-code-reviewer/index.ts
```

By default the example reviews `src/core/agent.ts`. Change `TARGET_FILE`
in the script to review a different file.

## What this demonstrates

- **Steering** — a system prompt + numbered rules + a few-shot example
  that primes the model to be thorough and to cite specific lines.
- **Tools** — the 5 built-ins (Read, Write, Edit, Bash, Grep) let the
  agent read source, search for patterns, and even apply the fixes it
  suggests.
- **Memory** — using `FileStore` so the review session persists across
  runs. Running the example twice in a row will continue the same review.
- **Observation** — subscribing to events with `agent.on('tool:call', ...)`
  to print what the agent is doing as it works.

## Try changing it

- Edit the steering rules in `STEERING.rules` to bias the reviewer
  (e.g. add 'always check for SQL injection in string-concatenated queries').
- Set `MEMORY_BACKEND = 'in-memory'` to see the difference (each run starts fresh).
- Add `maxIterations: 5` to cap how many tool calls the reviewer can make.
