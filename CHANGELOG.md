# Changelog

All notable changes to Husk are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project
adheres to [Semantic Versioning](https://semver.org/).

## [0.4.0] — 2026-06-13

### Added

- **`husk init` CLI subcommand**: `husk init <dir>` scaffolds a new Husk project
  with sensible defaults. Flags: `--provider anthropic|openai`, `--template
  minimal|full`, `--skip-install`. Writes `package.json`, `tsconfig.json`,
  `.gitignore`, `.env.example`, `src/hello-agent.ts`, and a project README.
  The `full` template additionally writes `src/code-reviewer.ts`. Exit code 0
  on success, 2 on usage error. Programmatic equivalent (`initCommand()` +
  `InitOptions`/`InitResult`) is exported from the main entry so users can
  build their own scaffolders on top.
- **Example 06 — `husk init` programmatic demo**: runs the same init logic
  the CLI uses, but in-process via a tmp dir. Shows the returned `InitResult`
  and a couple of the generated files for inspection.
- **Public API exports**: `initCommand`, `InitOptions`, `InitResult`,
  `InitProvider`, `InitTemplate` are now re-exported from the main entry
  (`@princetheprogrammerbtw/husk`).

### Changed

- README Quickstart now leads with the `npx @princetheprogrammerbtw/husk init`
  workflow as the path of least resistance for new users. The inline-build
  path stays right below for users who already have a project.
- CLI help text (`husk --help`) now documents the `init` subcommand and its
  three flags. `husk init --help` shows init-specific usage.

### Performance

- Bundle: 48KB → 49KB (init module is ~7KB of template strings; mostly
  re-exported types in the d.ts).
- Total tests: 72 → 87 (15 new init tests cover defaults, flags, paths,
  and the return-value contract).

### Deferred to v0.5.0

- Tool validation framework (declarative safety rules per tool)
- Streaming responses (Anthropic + OpenAI both support streaming; our
  Tracer already has streaming events; just need a streaming Provider
  interface)
- Real @opentelemetry/sdk-node integration example
- Vector store backends beyond in-memory (sqlite-vec, chroma)
- MCP (Model Context Protocol) adapter

## [0.3.0] — 2026-06-13

### Added

- **Vector memory** (`src/memory/vector.ts`, `vector-inmemory.ts`, `embedder-hash.ts`):
  long-term memory for agents via semantic recall. Three pieces —
  `VectorStore` interface (pluggable: ship `InMemoryVectorStore` for v0.3.0,
  users can write Chroma/Pinecone/sqlite-vec adapters), `EmbeddingProvider`
  interface (ship `HashEmbedder` for offline use, users can plug in
  OpenAI/Voyage/Cohere), and tool factories (`defineMemorySearchTool`,
  `defineRememberTool`) that wrap a store + embedder as agent-callable
  tools. The agent decides when to recall, no automatic injection.
- **OTel adapter** (`src/otel/`): subpath import `@princetheprogrammerbtw/husk/otel`
  that bridges Husk's minimal `Tracer` interface to the real
  `@opentelemetry/api` `Tracer`. `@opentelemetry/api` is an *optional*
  peer dependency — users who don't need OTel pay nothing.
- **`husk eval` CLI subcommand**: `husk eval <file-or-dir>` runs eval
  suites from the terminal for CI integration. Dynamic-imports user
  files (works for .ts via `tsx`, .js/.mjs out of the box), looks for
  exported `EvalSuite` objects, runs them, reports per-case results,
  exits with code 0 (all passed) or 1 (any failed).
- **Example 05 — vector memory**: two-session walkthrough demonstrating
  the agent remembering a user preference across sessions.
- **22 vector memory tests** + **vector example**.

### Changed

- `package.json` exports now includes `./otel` subpath.
- tsup config builds three entries: `index`, `cli/index`, `otel/index`.
- CI workflow: bumped `actions/checkout` from v4 to v5 (silences
  the Node 20 deprecation warning we saw on every run since v0.1.0).
- Total tests: 53 → 72 (a 1.4x increase).

### Performance

- Bundle: 45KB → 48KB (eval/obs grew slightly, otel is a separate
  1.7KB chunk that doesn't bloat the main bundle).

### Deferred to v0.4.0

- Real @opentelemetry/sdk-node integration example
- Vector store backends beyond in-memory (sqlite-vec, chroma)
- `husk init` CLI subcommand for project scaffolding
- MCP (Model Context Protocol) adapter
- Streaming responses
- Tool validation framework (declarative safety rules)

## [0.2.0] — 2026-06-13

### Added

- **Ollama provider** (`src/providers/ollama.ts`): local model support
  with zero API cost. Delegates to the OpenAI SDK because Ollama
  exposes an OpenAI-compatible API. Default model: `llama3.2`, default
  base URL: `http://localhost:11434/v1`.
- **Eval runner** (`src/evals/`): turn Husk from a tool into a
  testable framework. Six built-in assertions (`equals`, `contains`,
  `notContains`, `matches`, `fn`, `lengthBetween`), `defineSuite()`,
  and `runSuite()` with error isolation and optional `failFast`.
- **Tracer interface** (`src/obs/tracer.ts`): OTel-inspired minimal
  interface for observability backends. `NoopTracer` is the zero-
  overhead default.
- **EventTracer** (`src/obs/mapper.ts`): maps `AgentEvent` → tracer
  spans. One trace span per `agent.run`, iteration span per loop,
  tool span per tool call. Tokens, durations, and tool results all
  become structured span attributes.
- **Example 04 — evals**: runnable example demonstrating the eval
  runner with a fake agent (no API key required).
- **8 provider tests + 7 tracer tests + 20 eval tests** for a total
  of 53 unit tests, all passing.

### Changed

- Total tests: 19 → 53 (a 2.8x increase in coverage)
- Test file count: 1 → 4
- Public API surface grew: `OllamaProvider`, all eval functions,
  all obs types now reachable from the single import.

### Deferred to v0.3.0

- Vector memory store (chroma, sqlite-vec)
- Real `@opentelemetry/api` adapter (`@princetheprogrammerbtw/husk/otel` subpath)
- `husk eval <file>` CLI subcommand for running suites from the terminal
- `husk init` CLI subcommand for scaffolding new agent projects
- Google Gemini provider (Ollama already covers OpenAI-compatible)

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
