# Contributing to Husk

Thanks for your interest in Husk! This project is in active early
development and we welcome contributions of all kinds — code, docs,
bug reports, feature requests, design feedback.

## Code of conduct

Be kind. Assume good intent. Disagree on ideas, not people. We've all
shipped bugs; we've all missed obvious things. The bar is "would I
want to be treated this way in a code review?"

## Development setup

Husk uses [bun](https://bun.sh) for development. After cloning:

```bash
bun install
bun pm trust @biomejs/biome   # one-time, allows biome's WASM postinstall
```

## Scripts

```bash
bun run typecheck    # tsc --noEmit
bun run lint         # biome check .
bun run lint:fix     # biome check --write .
bun run format       # biome format --write .
bun test             # unit tests
bun run build        # tsup → dist/
bun run clean        # rm -rf dist
```

## Commit conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body explaining WHY]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
`build`, `ci`, `chore`. The scope is the module name (`core`,
`providers`, `tools`, `memory`, etc.) when applicable.

Examples:
- `feat(providers): add Ollama adapter`
- `fix(agent): handle tool execution timeout without crashing the loop`
- `docs: update README with CLI usage examples`
- `chore: bump version to 0.2.0`

The body should explain WHY, not what — the diff shows what.

## Pull request process

1. Fork the repo, create a feature branch from `main`.
2. Make atomic commits (one logical change per commit).
3. Run `bun run typecheck && bun run lint && bun test` locally — all
   must pass.
4. Open a PR against `main`. The PR description should:
   - Reference any related issue
   - Explain the motivation and design
   - List any breaking changes prominently
5. Wait for review. Be ready to iterate.

## Architecture overview

```
src/
├── core/          # agent loop, types, events, memory, steering
├── providers/     # anthropic, openai (more coming)
├── tools/         # registry helpers + builtin/
├── cli/           # the husk command
└── index.ts       # public API surface
examples/          # 3 worked examples
tests/             # bun test files
```

When adding a new module, follow the pattern: pure logic in its own
file, re-exported from `index.ts`, documented in `LEARNING.md` if the
design choices aren't obvious.

## Reporting bugs

Open an issue with:
- A minimal reproduction
- Expected vs actual behavior
- Node version, bun version, OS
- The full error message and stack trace

## Feature requests

Open an issue with:
- The problem you're trying to solve
- How you'd use the feature
- Alternatives you considered and why they don't work
- Whether you'd be willing to submit a PR

## License

By contributing, you agree that your contributions will be licensed
under the MIT License. See [LICENSE](./LICENSE).
