# Example 06 — `husk init` programmatic demo

Demonstrates the same scaffolding the CLI runs, but **in-process** —
no shell, no subprocess, no writing to your working dir beyond a temp
folder. Useful for:

- Previewing the files init will generate before running it for real.
- Building a custom scaffolder on top of Husk (Yeoman-style).
- Writing tests that exercise the init module without shelling out.

## Run it

```bash
bun run examples/06-husk-init/index.ts
```

## What you'll see

```
→ Scaffolding into /tmp/husk-init-demo-xyz/my-agent

✓ Scaffolded full Husk project
  Provider: anthropic
  Files:    7

    - package.json
    - tsconfig.json
    - .gitignore
    - .env.example
    - src/hello-agent.ts
    - README.md
    - src/code-reviewer.ts
```

The script also prints the contents of `src/hello-agent.ts` and a
highlights summary of `package.json`, then cleans up the temp dir.

## The CLI equivalent

If you'd rather use the CLI directly:

```bash
husk init my-agent
husk init my-agent --provider openai
husk init my-agent --template full
```

The CLI and the programmatic API produce identical file sets.

## Library usage

```ts
import { initCommand } from '@princetheprogrammerbtw/husk/cli';
// (the cli subpath is forthcoming — for now import from the package directly)
import { initCommand } from '@princetheprogrammerbtw/husk';

const result = await initCommand({
  target: './my-agent',
  provider: 'openai',
  template: 'full',
});
console.log(result.files);
```

## What this demonstrates

- **`initCommand` returns a structured `InitResult`** with `projectDir`,
  `files`, `provider`, and `template` — no need to parse CLI stdout.
- **Templates are deterministic** — same flags in = same files out.
  This makes them safe to diff and to test.
- **The CLI is a thin wrapper** — no business logic in the dispatcher.
  If you want a different UX (interactive prompts, a TUI, a web form),
  you can swap the CLI for your own front-end and call `initCommand`
  directly.
