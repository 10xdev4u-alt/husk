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

The example calls `initCommand` with `{ provider: 'anthropic', template: 'full' }`
and prints the returned `InitResult`. Set `HUSK_INIT_SKIP_INSTALL=1` and
`HUSK_INIT_SKIP_GIT=1` in the environment to short-circuit the auto-install and
auto-git steps the same way the test suite does.

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

# v0.4.1 additions
husk init my-agent --git --install               # git init + npm install in one go
husk init my-agent --package-manager pnpm        # override detection
husk init my-agent --force                       # overwrite an existing dir
husk init my-agent --no-interactive              # skip prompts (CI use)
```

The CLI and the programmatic API produce identical file sets.

## Library usage

```ts
import { initCommand, type InitOptions } from '@princetheprogrammerbtw/husk';

const result = await initCommand({
  target: './my-agent',
  provider: 'openai',
  template: 'full',
  // v0.4.1 options:
  // install: true,            // auto-run npm/pnpm/bun install
  // git: true,                // auto-init git + initial commit
  // gitAuthor: 'A <a@b>',     // override committer
  // packageManager: 'pnpm',   // override detection
  // force: true,              // overwrite existing dir
  // noInteractive: true,      // skip prompts (CI use)
});
console.log(result.files);
console.log(result.installExitCode);  // undefined if not run
console.log(result.gitExitCode);      // undefined if not run
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
