# Husk

> The agent harness that gives your LLM memory, hands, and a nervous system.

[![npm version](https://img.shields.io/npm/v/%40princetheprogrammerbtw%2Fhusk.svg)](https://www.npmjs.com/package/@princetheprogrammerbtw/husk)
[![npm downloads](https://img.shields.io/npm/dm/%40princetheprogrammerbtw%2Fhusk.svg)](https://www.npmjs.com/package/@princetheprogrammerbtw/husk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/node/v/%40princetheprogrammerbtw%2Fhusk.svg)](https://nodejs.org)
[![CI](https://github.com/10xdev4u-alt/husk/actions/workflows/ci.yml/badge.svg)](https://github.com/10xdev4u-alt/husk/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/10xdev4u-alt/husk.svg)](https://github.com/10xdev4u-alt/husk/stargazers)
[![Bundle size](https://img.shields.io/bundlephobia/minzip/%40princetheprogrammerbtw%2Fhusk.svg)](https://bundlephobia.com/package/@princetheprogrammerbtw/husk)

## What is Husk?

Most LLM calls are a **brain in a jar** — they can think, but can't act, remember, verify their own work, or show you what they did. **Husk** is the body, hands, memory, and nervous system you wrap around any LLM (Claude, GPT, Gemini, local models) to turn it into a real agent.

```ts
import { Agent, AnthropicProvider, Read, Write, Edit, Bash, Grep, FileStore } from '@princetheprogrammerbtw/husk';

const agent = new Agent({
  model: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
  tools: [Read, Write, Edit, Bash, Grep],
  memory: new FileStore({ path: './.husk/memory' }),
  steering: {
    systemPrompt: 'You are a careful code reviewer. Cite specific line numbers.',
    rules: [
      'Read the file in full before commenting.',
      'Prioritize security and correctness over style.',
    ],
  },
});

const result = await agent.run('Review src/core/agent.ts');
console.log(result.output);
```

## Why Husk?

| You're used to… | Husk gives you… |
|---|---|
| One-shot LLM calls with no memory | Persistent file-backed or in-memory memory across calls |
| Hand-rolled tool-calling loops | A small, typed event stream you can subscribe to |
| Tied to one provider's SDK | Provider-agnostic core; swap Anthropic ↔ OpenAI in one line |
| Reinventing agent loops in every project | Drop-in `Agent` class with stop conditions, parallel tool execution, and error recovery |
| No observability into what the model actually did | Typed events for every iteration, tool call, and provider response |

## Features

- 🧠 **Provider-agnostic** — Anthropic, OpenAI, more coming. Bring your own model.
- 🛠️ **5 built-in tools** — `Read`, `Write`, `Edit`, `Bash` (with safety denylist for `rm -rf /`, fork bombs, etc.), `Grep` (ripgrep with grep fallback)
- 💾 **Memory** — `InMemoryStore` for sessions, `FileStore` for persistence
- 👀 **Observability** — typed event emitter, drop in any logger or tracer
- 🧭 **Steering** — system prompts, numbered rules, few-shot examples
- 🤝 **Sub-agents** — compose agents inside agents (see [multi-agent example](./examples/03-multi-agent))
- 📦 **Batteries included** — 35KB ESM bundle, 26KB d.ts, zero runtime deps except the provider SDKs
- 🖥️ **CLI** — `husk run "<prompt>"` for one-shot invocations
- 🔒 **Type-safe** — strict TypeScript, no `any`, full type definitions shipped

## Install

```bash
npm install @princetheprogrammerbtw/husk
# or
pnpm add @princetheprogrammerbtw/husk
# or
bun add @princetheprogrammerbtw/husk
# or
yarn add @princetheprogrammerbtw/husk
```

You'll also need an API key for the provider you choose:

```bash
export ANTHROPIC_API_KEY=sk-ant-...    # for Claude
export OPENAI_API_KEY=sk-...           # for GPT
```

## Quickstart

**The fastest way in** — scaffold a new project with `husk init`:

```bash
npx @princetheprogrammerbtw/husk init my-agent
cd my-agent
cp .env.example .env       # paste your API key
npm install                # or pnpm / bun
npm start                  # runs src/hello-agent.ts
```

You'll get a runnable Husk project in under 30 seconds — `package.json`, `tsconfig.json`, a working `src/hello-agent.ts`, and a README. Use `--provider openai` to switch the example, or `--template full` to also get a `code-reviewer.ts` example.

---

**Or build one inline** — the smallest possible agent, no scaffolding:

```ts
import { Agent, AnthropicProvider } from '@princetheprogrammerbtw/husk';

const agent = new Agent({
  model: new AnthropicProvider({ model: 'claude-opus-4-6' }),
});

const result = await agent.run('What is the capital of France? Answer in one sentence.');
console.log(result.output); // "Paris"
```

A more realistic agent — with tools, memory, and steering:

```ts
import {
  Agent, AnthropicProvider, Read, Write, Edit, Bash, Grep,
  FileStore, InMemoryStore,
} from '@princetheprogrammerbtw/husk';

const agent = new Agent({
  model: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
  tools: [Read, Write, Edit, Bash, Grep],
  memory: new FileStore({ path: './.husk/memory' }),
  steering: {
    systemPrompt: 'You are a careful code reviewer.',
    rules: [
      'Read the file in full before commenting.',
      'Cite specific line numbers for every finding.',
    ],
  },
});

const result = await agent.run('Review src/core/agent.ts');
```

Swapping to OpenAI is a one-line change:

```ts
import { OpenAIProvider } from '@princetheprogrammerbtw/husk';

const agent = new Agent({
  model: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
  // ...same config otherwise
});
```

## CLI

```bash
# Run an agent from the command line
husk run "What is the capital of France?"
husk run "Refactor src/foo.ts" --tools read,edit,write
husk run "Summarize README.md" --provider openai --model gpt-5

# Run eval suites from the terminal (CI integration)
husk eval ./evals/geography.ts
husk eval ./evals/                  # all .ts/.js/.mjs in the dir

# Scaffold a new Husk project
husk init my-agent
husk init my-agent --provider openai
husk init my-agent --template full

# Help
husk --help
husk init --help
```

The CLI wraps the same `Agent` class — flags map directly to `AgentConfig` fields.

## Examples

Six worked examples in the [`examples/`](./examples) directory:

- **[01-hello-agent](./examples/01-hello-agent)** — minimal agent, no tools
- **[02-code-reviewer](./examples/02-code-reviewer)** — full tool set + steering for code review
- **[03-multi-agent](./examples/03-multi-agent)** — three agents composed in sequence (planner → coder → reviewer)
- **[04-evals](./examples/04-evals)** — assertion-based eval suite you can run with `husk eval`
- **[05-vector-memory](./examples/05-vector-memory)** — long-term memory via semantic recall across sessions
- **[06-husk-init](./examples/06-husk-init)** — programmatic demo of the `husk init` scaffolder

Run any example with `bun run examples/0X-name/index.ts`.

## Documentation

- 📓 **[Learning Journal](./LEARNING.md)** — design decisions, trade-offs, and lessons learned while building
- 📋 **[Changelog](./CHANGELOG.md)** — release history
- 🤝 **[Contributing](./CONTRIBUTING.md)** — how to contribute
- 🏗️ **[Architecture](#architecture)** — the module layout, below

## Architecture

```
src/
├── core/          # agent loop, types, events, memory, steering
├── providers/     # anthropic, openai, ollama
├── tools/         # registry helpers + 5 built-ins (read/write/edit/bash/grep)
├── memory/        # vector memory (InMemoryVectorStore, HashEmbedder, tool factories)
├── evals/         # assertion DSL + runSuite
├── obs/           # Tracer interface + EventTracer
├── otel/          # optional @opentelemetry/api bridge (subpath: /otel)
├── cli/           # the husk command (run, eval, init)
└── index.ts       # public API surface
```

Every piece composes through a **typed event stream**. The agent loop is ~150 lines. Provider adapters are the only files that know about provider-specific wire formats. Tools are plain objects implementing a 4-field interface — register by passing an array to the Agent.

The `cli/` directory is the only place that touches `process.argv` or the filesystem outside the workdir — the rest of the codebase is pure, testable, and embeddable in any host (CLI, server, edge function, Electron app, etc.).

## Roadmap

- **v0.1.0** ✅ Core loop, Anthropic + OpenAI, 5 built-in tools, memory, observability, CLI
- **v0.1.1** ✅ CLI shebang fix, version bump
- **v0.2.0** ✅ Ollama adapter, eval runner with assertion DSL, Tracer + EventTracer
- **v0.3.0** ✅ Vector memory, OTel adapter (subpath), `husk eval` CLI
- **v0.4.0** 🚧 `husk init` project scaffolder, more examples, public API exports
- **v1.0.0** Stable API, marketplace, enterprise features

## Contributing

PRs welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for the dev setup, scripts, and commit conventions.

The project follows Conventional Commits. Every commit body explains *why*, not what — the diff already shows what.

## Show your support

If Husk saves you time, ⭐️ the [GitHub repo](https://github.com/10xdev4u-alt/husk) — it helps others find the project. Issues, PRs, and feedback all welcome.

## License

MIT © 2026 [princetheprogrammerbtw](https://github.com/10xdev4u-alt)
