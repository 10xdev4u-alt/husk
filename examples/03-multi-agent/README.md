# Example 03 — Multi-Agent Orchestrator

Three Husk agents working in concert: a planner that breaks a task
into subtasks, two specialists (a coder and a reviewer) that execute
them, and an orchestrator that ties it all together.

This example is illustrative — it shows the *pattern* for composing
agents. A real production system would add error recovery, retries,
state persistence, and human-in-the-loop checkpoints.

## Run it

```bash
export ANTHROPIC_API_KEY=sk-...
bun run examples/03-multi-agent/index.ts
```

You should see the planner emit a 2-step plan, the coder write a
small utility file, and the reviewer inspect it.

## What this demonstrates

- **Agent composition** — one `Agent` instance can construct and call
  others, treating them as tools-in-the-large.
- **Tool specialization** — the planner has no file tools (it only
  thinks); the coder has all 5 file tools; the reviewer has Read+Grep.
  Smaller tool sets = better tool selection by the model.
- **Sequential orchestration** — the orchestrator calls agents in
  sequence (planner → coder → reviewer), passing context between them.
  Parallel orchestration is also possible but adds coordination cost.

## Why this matters

The multi-agent pattern is what scales an agent harness from a
single-model trick to a team-of-models workflow. Codebuff's core
innovation is making this composition cheap and observable; Husk
gives you the same primitives with a smaller surface.
