# Example 11 — Tool approval flow

Builds an agent with a `Bash` tool that has `requireApproval: true`. When the model tries to run a command, the agent pauses and asks the caller (here: a stub callback) for permission. The caller decides approved/denied; the agent acts accordingly.

No API key needed — the example uses a fake provider that emits pre-canned tool_use calls. Swap in `AnthropicProvider` to see the real flow.

## Run it

```bash
bun run examples/11-approval/index.ts
```

## What you'll see

```
→ Tool approval flow demo

→ Running agent on fake prompt that calls Bash twice...

  [approval] 'ls /tmp' — APPROVED
  [approval] 'rm -rf /' — DENIED

→ Final output: I see the second command was denied.
→ Iterations:   3
```

3 iterations:
1. The agent calls `bash` with `'ls /tmp'` — the callback approves, the tool runs, returns success.
2. The agent calls `bash` with `'rm -rf /'` — the callback denies (not in the safe set), the model sees a clean error.
3. The agent acknowledges the denial in its final message.

## What this demonstrates

- **`requireApproval: true` on `ToolDefinition`** pauses the agent loop before the tool runs.
- **`onApprovalRequest` callback** in `AgentConfig` decides the outcome. Return `{ approved: true }` to proceed, `{ approved: false, reason: '...' }` to deny.
- **Denied calls surface as `isError: true` to the model** with the callback's reason, so the model can self-correct ("oh, I shouldn't have tried `rm`, let me try a safer approach").
- **No API key needed** — the `DemoProvider` emits pre-canned tool_use calls and a final end_turn. Useful for unit tests and CI demos.
- **The example's stub callback is the simplest possible policy** — approve `ls` / `cat` / `echo`, deny everything else. Real apps would prompt the user, log the decision, or check a server-side allowlist.

## Library usage

```ts
import { Agent, AnthropicProvider } from '@princetheprogrammerbtw/husk';

const bash = defineTool({
  name: 'bash',
  description: 'Run a shell command',
  inputSchema: objectSchema({ command: stringField() }),
  requireApproval: true,  // ← gate the call
  execute: async ({ command }) => /* run command */,
});

// The CLI ships a default readline-based prompt. Reuse it:
import { defaultCliApprovalPrompt } from '@princetheprogrammerbtw/husk/cli';

const agent = new Agent({
  model: new AnthropicProvider(),
  tools: [bash],
  onApprovalRequest: defaultCliApprovalPrompt(),
});
```

Or write your own:

```ts
const agent = new Agent({
  model: new AnthropicProvider(),
  tools: [bash],
  onApprovalRequest: async (req) => {
    // Show a GUI dialog, log to an audit trail, check a server-side
    // allowlist, anything you want. Return { approved: true } or
    // { approved: false, reason: '...' }.
    return { approved: await askUserViaGUI(req.reason) };
  },
});
```

## Safe defaults

- **No `onApprovalRequest` configured** → requireApproval tools are blocked by default with a clear error message. This is the safe default — silent 'yes' would be worse than loud 'no'.
- **Non-TTY CLI invocation** (CI, AI agents, piped input) → the default CLI prompt auto-denies with a reason pointing the user at the override.
- **`--no-approval` flag on `husk run`** → blocks all requireApproval tools (the callback is never wired). Useful for batch scripts that know their tools are safe.

## How it works internally

`executeTool()` in the agent loop checks `tool.requireApproval` AFTER validation rules but BEFORE `execute()`:

1. **No `onApprovalRequest` on the Agent** → return `{ output: '...blocked, no callback configured...', isError: true }`. The model sees the error and can suggest a different approach.
2. **`onApprovalRequest` is wired** → invoke it with `{ toolName, input, reason }`. The reason is a short summary (`"bash wants to run with: {\"command\":\"rm -rf /\"}"`) suitable for prompt UIs.
3. **approved: true** → proceed to `execute()`.
4. **approved: false** → return `{ output: '...was not approved. <reason>', isError: true }`. The reason flows back to the model so it can adapt.

Both `run()` and `streamRun()` share the same `executeTool()` path, so the approval gate applies to both. The `streamRun()` path yields the same `tool_result` event whether the tool ran or was blocked — consumers don't need to special-case denial.
