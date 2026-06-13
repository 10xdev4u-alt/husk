# Changelog

All notable changes to Husk are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project
adheres to [Semantic Versioning](https://semver.org/).

## [0.1.1] — 2026-06-13

### Fixed

- **CLI shebang**: added `#!/usr/bin/env node` to the CLI bundle via
  tsup's `banner` option. Without this, npm stripped the `husk` bin
  entry on publish, so `husk run` wasn't available after install.
  Users can now run `husk run "<prompt>"` after `npm install -g`
  or via `npx husk`.
- **VERSION constant**: bumped to 0.1.0 (was stale at 0.0.1 from
  the initial scaffold).

## [0.1.0] — 2026-06-13

The first public release of Husk — a provider-agnostic, batteries-included
agent harness for the Node/TypeScript ecosystem.

### Added

- **Core agent loop** (`src/core/agent.ts`) with stop conditions, parallel
  tool execution, fault-tolerant tool error handling, and configurable
  max iterations.
- **Provider adapters** for Anthropic Claude (`src/providers/anthropic.ts`)
  and OpenAI Chat Completions (`src/providers/openai.ts`).
- **Memory stores**: `InMemoryStore` (session-scoped) and `FileStore`
  (persistent JSONL on disk, per-session or unified).
- **Steering**: `buildSystemPrompt()` and `buildExampleMessages()` for
  shaping agent behavior with system prompts, numbered rules, and
  few-shot examples.
- **Typed event emitter** (`AgentEventEmitter`) with discriminated-union
  event types, per-type and wildcard handlers, and error-isolated
  subscriber execution.
- **Built-in tools**: `Read`, `Write`, `Edit`, `Bash` (with safety
  denylist and configurable timeout), `Grep` (ripgrep with grep fallback).
- **Tool registry helpers** (`defineTool`, `objectSchema`, `stringField`,
  etc.) for less-verbose custom tool construction.
- **CLI** (`src/cli/index.ts`): `husk run "<prompt>"` with flags for
  model, provider, tools, memory, and max iterations.
- **Three worked examples** in `examples/`:
  - `01-hello-agent` — minimal Agent
  - `02-code-reviewer` — full tool set + steering
  - `03-multi-agent` — three agents composed in sequence
- **Build** via tsup: ESM bundles for library (35KB) and CLI (36KB),
  full `.d.ts` type declarations, sourcemaps.
- **Tests**: 19 unit tests covering memory stores, steering builders,
  and the event emitter. All pass via `bun test`.

### Configuration defaults

- Default model: `claude-opus-4-6` (Anthropic)
- Default provider: `anthropic`
- Default max iterations: 25
- Default temperature: 0
- Node engine: `>=18.0.0`

### Deferred to v0.2.0

- Eval runner with assertion DSL
- OTel-compatible tracing export
- Ollama and Google Gemini provider adapters
- Vector-backed memory store
- Per-tool confirmation prompts in Bash (config flag)
- `husk init` and `husk eval` CLI subcommands

[0.1.0]: https://github.com/10xdev4u-alt/husk/releases/tag/v0.1.0
