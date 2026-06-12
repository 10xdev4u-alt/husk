# Husk

> The agent harness that gives your LLM memory, hands, and a nervous system.

[![npm version](https://img.shields.io/npm/v/%40princetheprogrammerbtw%2Fhusk.svg)](https://www.npmjs.com/package/@princetheprogrammerbtw/husk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/node/v/%40princetheprogrammerbtw%2Fhusk.svg)](https://nodejs.org)
[![CI](https://github.com/10xdev4u-alt/husk/actions/workflows/ci.yml/badge.svg)](./.github/workflows/ci.yml)

## What is Husk?

Most LLM calls are a brain in a jar — they can think, but can't act, remember, verify their own work, or show you what they did. **Husk** is the body, hands, memory, and nervous system you wrap around any LLM (Claude, GPT, Gemini, local models) to turn it into a real agent.

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

## Features

- 🧠 **Provider-agnostic** — Anthropic, OpenAI, more coming. Bring your own model.
- 🛠️ **5 built-in tools** — `Read`, `Write`, `Edit`, `Bash` (with safety denylist), `Grep` (ripgrep with grep fallback)
- 💾 **Memory** — `InMemoryStore` for sessions, `FileStore` for persistence
- 👀 **Observability** — typed event emitter, drop in any logger or tracer
- 🧭 **Steering** — system prompts, numbered rules, few-shot examples
- 🤝 **Sub-agents** — compose agents inside agents (see [multi-agent example](./examples/03-multi-agent))
- 📦 **Batteries included** — 35KB ESM bundle, full TypeScript types
- 🖥️ **CLI** — `husk run "<prompt>"` for one-shot invocations

## Install

```bash
npm install @princetheprogrammerbtw/husk
# or
pnpm add @princetheprogrammerbtw/husk
# or
bun add @princetheprogrammerbtw/husk
```

You'll also need an API key for the provider you choose:

```bash
export ANTHROPIC_API_KEY=sk-ant-...    # for Claude
export OPENAI_API_KEY=sk-...           # for GPT
```

## Quickstart

The smallest possible agent:

```ts
import { Agent, AnthropicProvider } from '@princetheprogrammerbtw/husk';

const agent = new Agent({
  model: new AnthropicProvider({ model: 'claude-opus-4-6' }),
});

const result = await agent.run('What is the capital of France? Answer in one sentence.');
console.log(result.output); // "Paris"
```

## CLI

```bash
# Run an agent from the command line
husk run "What is the capital of France?"
husk run "Refactor src/foo.ts" --tools read,edit,write
husk run "Summarize README.md" --provider openai --model gpt-5
husk run --help
```

## Examples

Three worked examples in the `examples/` directory:

- **[01-hello-agent](./examples/01-hello-agent)** — minimal agent, no tools
- **[02-code-reviewer](./examples/02-code-reviewer)** — full tool set + steering for code review
- **[03-multi-agent](./examples/03-multi-agent)** — three agents composed in sequence (planner → coder → reviewer)

Run any example with `bun run examples/0X-name/index.ts`.

## Documentation

- **[Learning Journal](./LEARNING.md)** — design decisions, trade-offs, and lessons learned
- **[Changelog](./CHANGELOG.md)** — release history
- **[Contributing](./CONTRIBUTING.md)** — how to contribute

## Architecture

```
src/
├── core/          # agent loop, types, events, memory, steering
├── providers/     # anthropic, openai (more coming)
├── tools/         # registry helpers + 5 built-ins
├── cli/           # the husk command
└── index.ts       # public API surface
```

Every piece composes through a typed event stream. The agent loop is ~150 lines. Provider adapters are the only files that know about provider-specific wire formats.

## Roadmap

- **v0.1.0** ✅ Core loop, Anthropic + OpenAI, 5 built-in tools, memory, observability, CLI
- **v0.2.0** Eval runner, OTel export, Ollama adapter
- **v0.3.0** Vector memory, hosted dashboard
- **v1.0.0** Stable API, marketplace, enterprise features

## License

MIT © 2026 princetheprogrammerbtw
