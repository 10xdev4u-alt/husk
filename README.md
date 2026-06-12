# Husk

> The agent harness that gives your LLM memory, hands, and a nervous system.

[![npm version](https://img.shields.io/npm/v/%40princetheprogrammerbtw%2Fhusk.svg)](https://www.npmjs.com/package/@princetheprogrammerbtw/husk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/node/v/%40princetheprogrammerbtw%2Fhusk.svg)](https://nodejs.org)

## What is Husk?

Most LLM calls are a brain in a jar — they can think, but can't act, remember, verify their own work, or show you what they did. **Husk** is the body, hands, memory, and nervous system you wrap around any LLM (Claude, GPT, Gemini, local models) to turn it into a real agent.

```ts
import { Agent, Anthropic, Read, Write, Bash, Memory } from '@princetheprogrammerbtw/husk';

const agent = new Agent({
  model: new Anthropic({ model: 'claude-opus-4-6' }),
  tools: [Read, Write, Bash],
  memory: new Memory({ backend: 'file', path: './memory.jsonl' }),
});

const result = await agent.run('Refactor the auth module to use Argon2id');
console.log(result.output);
```

## Features

- 🧠 **Provider-agnostic** — Anthropic, OpenAI, Google, Ollama — bring your own model
- 🛠️ **Tool registry** — Drop-in tools with JSON Schema validation
- 💾 **Memory** — In-memory for sessions, file-backed for cross-session persistence
- 👀 **Observability** — Event-based, plug into any tracer
- 🧭 **Steering** — System prompts, rules, few-shot examples
- 🤝 **Sub-agents** — Spawn specialized agents from inside another
- 📦 **Batteries included** — 5 built-in tools to start, easy to add more
- 🔌 **Composable** — Use as a library, a CLI, or embed in your app

## Install

```bash
npm install @princetheprogrammerbtw/husk
# or
pnpm add @princetheprogrammerbtw/husk
# or
bun add @princetheprogrammerbtw/husk
```

## Quickstart

```ts
import { Agent, Anthropic } from '@princetheprogrammerbtw/husk';

const agent = new Agent({
  model: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
});

const result = await agent.run('What is the capital of France?');
console.log(result.output); // "Paris"
```

See [`examples/`](./examples) for more, including code review and multi-agent orchestration.

## Roadmap

- **v0.1.0** — Core agent loop, Anthropic + OpenAI adapters, 5 built-in tools, memory, observability, sub-agents
- **v0.2.0** — Eval runner, OTel export, Ollama adapter
- **v0.3.0** — Vector memory, hosted dashboard
- **v1.0.0** — Stable API, marketplace, enterprise features

## Documentation

- [Quickstart](./examples/01-hello-agent) — your first agent in 5 minutes
- [API Reference](./docs/api.md) _(coming soon)_
- [Architecture](./docs/architecture.md) _(coming soon)_
- [Learning Journal](./LEARNING.md) — design decisions, trade-offs, lessons learned

## Contributing

PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) _(coming soon)_.

## License

MIT © 2026 princetheprogrammerbtw
