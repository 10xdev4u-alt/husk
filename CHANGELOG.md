# Changelog

All notable changes to Husk are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project
adheres to [Semantic Versioning](https://semver.org/).

## [0.5.0] — 2026-06-13

### Added

- **Streaming responses** — the `stream?` method on the `Provider` interface (declared but unimplemented in v0.3.0) is now shipped on all three providers:
  - `AnthropicProvider.stream()` wraps `client.messages.stream()` as an `AsyncIterable<ChatChunk>` (text deltas, tool_use_start, tool_use_delta, message_end).
  - `OpenAIProvider.stream()` wraps `client.chat.completions.create({ stream: true, stream_options: { include_usage: true } })` (same chunk shape; tool_call index tracking for parallel tool calls).
  - `OllamaProvider.stream()` delegates to the inner OpenAIProvider (Ollama is OpenAI-compatible).
- **`Agent.streamRun(input)`** — the streaming counterpart to `Agent.run()`. Yields `AgentStreamEvent`s: `text` deltas, `tool_call_start` / `tool_call_delta`, `tool_result`, `done`, `error`. Mirrors `run()` exactly (same memory, tools, iteration cap, error isolation). Falls back to a single `text` + `done` event when the provider doesn't implement `stream()`.
- **`--stream` flag for `husk run`** — routes the prompt through `streamRun()`. Text deltas go to stdout; tool calls and results go to stderr so the streamed output is pipe-friendly.
- **Tool validation framework** (`src/tools/validation.ts`):
  - `ValidationContext` (toolName, cwd, input, env) + `ValidationRule` (name, check fn) + `ValidationRuleSet` (single rule or array)
  - `defineValidation(name, check)` and `defineValidationSet(...rules)` helpers
  - `normalizeRules(set)` for internal use
  - Four common validators: `pathAllowed({ baseDir })`, `commandDenylist([...cmds])`, `maxFieldSize({ field, maxBytes })`, `noShellMetacharacters({ field })`
  - Agent loop integration: `validate?` rules run after schema validation and before `execute()`. First failure short-circuits with that error message.
- **`requireApproval?: boolean`** on `ToolDefinition` — flag for tools that need caller approval (production mutations, infra deploys, untrusted code execution). Integration with the caller is left to the embedder (CLI prompt, server 202 response, etc.).
- **Public API exports** for the validation framework (`defineValidation`, `defineValidationSet`, `normalizeRules`, `pathAllowed`, `commandDenylist`, `maxFieldSize`, `noShellMetacharacters` + types).
- **Examples**:
  - `07-streaming` — `agent.streamRun()` end-to-end with a real Anthropic key (or a fake provider that yields word-by-word)
  - `08-validation` — sandboxed Write tool with `pathAllowed()` showing the validation gate in action
  - `09-otel-sdk` — real OpenTelemetry SDK pipeline (commented-out bootstrap code, working OtelTracerAdapter + EventTracer wiring)

### Changed

- `Provider.stream?` is no longer optional in practice — the three shipped providers all implement it. Custom providers that only implement `chat()` still work via the `streamRun()` fallback.

### Performance

- Bundle: 51KB → 53KB (streaming adds ~1KB to each provider; validation module is ~2KB).
- Total tests: 120 → 155 (35 new tests across streaming + validation).

### Deferred to v0.6.0

- MCP (Model Context Protocol) adapter — both client (consume MCP servers as Husk tools) and server (expose Husk tools as MCP)
- Real SQLite / Chroma vector store backends (v0.5.0 has the `VectorStore` interface; v0.6.0 fills in concrete impls)
- Tool approval flow end-to-end (caller-side hook for `requireApproval` — CLI prompt, server 202, etc.)
- More init templates (with-tests, ESM-only, monorepo-aware)
- Gemini provider (low priority; Ollama covers OpenAI-compatible)

## [0.4.1] — 2026-06-13

### Added

- **`husk init` v2** (existing command, many new flags):
  - `--install` — auto-run the detected package manager's install command after writing files. Default: off (opt-in so AI agents and CI don't hang on a 60-second install they didn't ask for).
  - `--git` — auto-initialize a git repo and create an initial commit (`chore: scaffold husky agent`). Uses `git init --initial-branch=main` (with a `git init` fallback for older gits), then `git add .`, then `git commit`. The `.gitignore` we write keeps `node_modules` and `dist` out of the commit.
  - `--git-author "Name <email>"` — override the committer identity for the initial commit.
  - `--package-manager npm|pnpm|bun|yarn` — override the auto-detected package manager.
  - `--force` — overwrite existing files in the target dir. Default: throw `InitError` (silent overwrites are the wrong default for a scaffolder).
  - `--no-interactive` — skip all prompts even in a TTY. Default: off in TTY (we ask for missing options), on in non-TTY (CI / scripted use gets deterministic defaults).
  - `force: 'prompt'` (library option) — ask the user before overwriting. Falls back to throwing in non-TTY contexts.
  - **Interactive prompts** for provider + template when those flags are missing and the invocation is in a TTY. Defaults shown in brackets (`[anthropic]`), choices shown in parens (`(anthropic/openai)`), invalid input re-prompts once.
  - **Package manager detection** — picks npm / pnpm / bun / yarn from `npm_config_user_agent` (priority) → lockfile in the target dir (pnpm-lock.yaml, bun.lock, bun.lockb, yarn.lock) → default to npm.
- **Public API additions** to the init module:
  - `isEmptyDir(dir)` / `isExistingProject(dir)` — async helpers used by the overwrite gate
  - `detectPackageManager(targetDir, env?)` — pure function with injectable env for tests
  - `getInstallCommand(pm)` — returns the argv for a given package manager
  - `runInstall(targetDir, pm, env?)` — spawnSync wrapper, returns exit code
  - `runGitInit(targetDir, env?, opts?)` — spawnSync wrapper for the three git steps
  - `prompt(question, options?)` — readline-based prompt with TTY detection
  - `InitError` — thrown when the overwrite gate trips; carries the projectDir
  - `PromptError` — thrown when `prompt()` is called from a non-TTY context
  - `PackageManager` type — `'npm' | 'pnpm' | 'bun' | 'yarn'`
- **InitResult grows**: `packageManager`, `installExitCode`, `gitExitCode` fields.
- **InitOptions grows**: `install`, `git`, `gitAuthor`, `packageManager`, `force` (now `boolean | 'prompt'`), `noInteractive`.
- **Test env vars** for short-circuiting auto-steps: `HUSK_INIT_SKIP_INSTALL=1`, `HUSK_INIT_SKIP_GIT=1`, `HUSK_INIT_NON_INTERACTIVE=1`.

### Changed

- Default overwrite behavior: `husk init` now **throws** if the target dir is non-empty (previously: silently overwrote). Use `--force` to restore the old behavior, or `--no-interactive` in CI.
- Post-init summary now reports `install` and `git` exit codes (when those steps ran) so the user sees at a glance whether the auto-steps succeeded.
- The `package.json` template now pins `@princetheprogrammerbtw/husk` at `^0.4.1`.

### Performance

- Bundle: 49KB → 51KB (init module grew by ~2KB; the bulk is the readline-based prompt helper and the runInstall/runGitInit spawnSync wrappers).
- Total tests: 87 → 120 (32 new init-v2 tests cover helpers, detection, force, install, git, prompt).

### Fixed

- CI publish auth (`7f27492`): previous workflow relied on `bunx npm publish` picking up the `NPM_TOKEN` env var, which doesn't always propagate. The new flow writes the token to `~/.npmrc` explicitly before publishing. v0.4.0 was published manually with this fix already in place; future tag pushes will auto-publish on the first try.

### Deferred to v0.5.0

- Tool validation framework (declarative safety rules per tool)
- Streaming responses (Anthropic + OpenAI both support streaming; our Tracer has streaming events)
- Real @opentelemetry/sdk-node integration example
- Vector store backends beyond in-memory (sqlite-vec, chroma)
- MCP (Model Context Protocol) adapter
- More init templates (with-tests, ESM-only, monorepo-aware)

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
