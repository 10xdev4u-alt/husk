# Husk — Learning Journal

This document captures the *why* behind Husk. The README describes *what* Husk is; this file is the running journal of design decisions, trade-offs, and lessons learned while building it. Updated as the project grows.

---

## Why "Husk"?

The metaphor: the LLM is the kernel of intelligence (the "grain"); the harness is the protective shell that makes it useful in the real world (the "husk"). The name is short, brandable, and conveys that real-world utility comes from what wraps the raw kernel, not from the kernel itself.

## Why TypeScript + ESM + Node 18+?

- **TypeScript** — the AI agent ecosystem is converging on TS (Vercel AI SDK, Mastra, LangChain.js, Anthropic SDK, OpenAI SDK). Strong typing prevents entire classes of runtime errors that bite hardest in agent loops, where execution is non-deterministic and bugs are hard to reproduce.
- **ESM-first** — ESM is the future of Node. CommonJS is in maintenance mode. We don't use it.
- **Node 18+** — covers 90%+ of active users. Gives us native `fetch`, `WebStreams`, and `structuredClone`. No need for polyfills or transpilation gymnastics.

## Why bun for development?

- Zero-config TypeScript (no ts-node, no tsx — just `bun run`).
- Built-in test runner (`bun test`) — covers what we need for v0.1.0.
- Faster install than pnpm/npm via binary lockfile + content-addressable store.
- Smaller disk footprint on constrained machines (we have 5.8GB free — every MB counts).

We still **ship to npm** and support Node 18+ as the runtime. Bun is purely for developer velocity — end users can install with any Node package manager.

## Why Biome for lint + format?

Biome is the modern replacement for ESLint + Prettier. Single binary, 10–100x faster, zero config required, opinionated defaults that match what most teams want. Saves a project from 50+ ESLint rule config files and the inevitable `eslint-config-prettier` dance.

## Why no Vitest (yet)?

`bun test` covers what we need for v0.1.0: unit tests on core types, smoke tests on provider adapters, assertion-style tests. We can swap to Vitest later if we need Jest-compatible APIs (snapshot testing, complex mocking, parallel workers).

## Core architecture (high level)

```
┌─────────────────────────────────────────────┐
│  Agent (the harness)                        │
│  ┌───────────────────────────────────────┐  │
│  │  Loop: call → parse → execute → ...   │  │
│  │  ├── Provider  (Anthropic, OpenAI,…)  │  │
│  │  ├── Tools     (registry + built-ins) │  │
│  │  ├── Memory    (in-mem, file)         │  │
│  │  ├── Steering  (rules, examples)      │  │
│  │  └── Sub-agents (specialist spawning) │  │
│  └───────────────────────────────────────┘  │
│  Events: agent:start, tool:call, …          │
└─────────────────────────────────────────────┘
```

## Design decisions log

### 2026-06-13 — Project started

**Why now?** The OSS agent framework landscape is fragmented: LangGraph is powerful but Python-only, Vercel AI SDK is too thin, Claude/OpenAI Agent SDKs lock you in, Mastra lacks evals, and Codebuff is proprietary. There's a clear gap for a TypeScript-first, provider-agnostic, batteries-included agent harness that ships memory + tools + evals + observability + sub-agents in one drop-in library.

**Target audience:** solo developers and small teams shipping AI features. Optimize for the "10 lines of code, ship a real agent" experience.

**License:** MIT — maximum adoption, no surprises for downstream users.
