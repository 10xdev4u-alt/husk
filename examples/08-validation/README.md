# Example 08 — Tool validation framework

Builds a "safe file editor" agent that can only write files within
a configurable project root. The model can't escape via absolute
paths or `..` traversal — every Write is checked by `pathAllowed()`
before it runs.

## Run it

```bash
bun run examples/08-validation/index.ts
```

## What you'll see

```
→ Demo project root: /tmp/husk-validation-xxxxxx

→ Running agent on fake prompt that should call Write twice...

→ Final output: I see the validation error.
→ Iterations:   3

→ Cleaned up /tmp/husk-validation-xxxxxx
```

3 iterations:
1. The agent calls `write_file` with `path: 'src/hello.txt'` — **passes** validation, the file is written.
2. The agent calls `write_file` with `path: '../../../etc/passwd'` — **blocked** by `pathAllowed()`. The agent sees a clean error message: `Error: tool 'write_file' blocked by validation rule 'path-allowed(husk-validation-xxxxxx)': Path '../../../etc/passwd' resolves to '/etc/passwd', which is outside the allowed base directory '/tmp/husk-validation-xxxxxx'`
3. The agent acknowledges the error in its final message.

## What this demonstrates

- **`pathAllowed()` is the canonical "stay in your sandbox" validator.** Pass it any file-mutating tool (Write, Edit, Read) and it keeps the model from poking at `/etc`, `~/.ssh`, etc.
- **Validation is transparent to the model.** The error flows back through the standard `tool_result` channel with `isError: true`, so the model sees a normal "your call failed because..." message and can self-correct.
- **No DSL, no magic.** `validate` is just a function `(input, ctx) => string | null`. Custom validators are a one-liner.
- **The agent loop is unchanged.** The framework sits between schema validation and `execute()`. If the rule fails, `execute()` never runs.

## Library usage

```ts
import { Agent, AnthropicProvider } from '@princetheprogrammerbtw/husk';
import { defineTool, objectSchema, stringField } from '@princetheprogrammerbtw/husk';
import { pathAllowed, commandDenylist, maxFieldSize } from '@princetheprogrammerbtw/husk';

const safeBash = defineTool({
  name: 'bash',
  description: 'Run a shell command in the project',
  inputSchema: objectSchema({ command: stringField() }),
  // Compose multiple rules — any failure blocks the call.
  validate: [
    commandDenylist(['rm', 'mkfs', 'dd', 'shutdown']),
    // Could also add: noShellMetacharacters({ field: 'command' })
  ],
  execute: async ({ command }) => /* run command */,
});

const safeWrite = defineTool({
  name: 'write_file',
  description: 'Write a file within the project',
  inputSchema: objectSchema({
    path: stringField(),
    content: stringField(),
  }),
  validate: [
    pathAllowed({ baseDir: process.cwd() }),
    maxFieldSize({ field: 'content', maxBytes: 1_000_000 }),
  ],
  execute: async ({ path, content }) => /* write file */,
});

const agent = new Agent({
  model: new AnthropicProvider(),
  tools: [safeBash, safeWrite],
});
```

## Available validators

| Validator | Catches |
|---|---|
| `pathAllowed({ baseDir, field? })` | Absolute paths, `..` traversal |
| `commandDenylist([...cmds])` | First-token match against a denylist (case-insensitive) |
| `maxFieldSize({ field, maxBytes })` | String fields over a byte cap (counts UTF-8 bytes) |
| `noShellMetacharacters({ field })` | Unescaped `$( )`, backticks, `&&`, `\|\|`, `;` |

Custom validators are easy:

```ts
import { defineValidation } from '@princetheprogrammerbtw/husk';

const noProdFiles = defineValidation('no-prod-files', (input) => {
  const path = (input as { path?: string })?.path ?? '';
  if (path.startsWith('/prod/') || path.includes('prod.db')) {
    return `Path '${path}' touches production data. Use the staging environment.`;
  }
  return null;
});
```

## How it works internally

`defineTool()` accepts a `validate` field (single rule or array).
The agent loop runs each rule in order before `execute()`. The
first non-null return value short-circuits with that error
message — the rest don't run, and `execute()` is skipped.

The full framework lives in `src/tools/validation.ts`. See the
JSDoc on each validator for the exact check semantics.
