/**
 * Example 11 — Tool approval flow.
 *
 * Builds an agent with a Bash tool that has `requireApproval: true`.
 * When the model tries to run a command, the agent pauses and
 * asks the caller (here: an auto-approving stub) for permission.
 * The caller can return approved: true (proceed) or approved: false
 * (block, surface the denial to the model).
 *
 * No API key needed — the example uses a fake provider that
 * emits pre-canned tool_use calls. Swap in AnthropicProvider
 * to see the real flow.
 */

import { Agent } from '../../src/core/agent.js';
import type {
  ApprovalRequest,
  ApprovalResult,
  ChatRequest,
  Provider,
} from '../../src/core/types.js';
import { defineTool, objectSchema, stringField } from '../../src/tools/registry.js';

async function main() {
  console.log('\n→ Tool approval flow demo\n');

  // A tool that's clearly dangerous — every call needs approval.
  const bash = defineTool({
    name: 'bash',
    description: 'Run a shell command',
    inputSchema: objectSchema({ command: stringField() }),
    requireApproval: true,
    execute: async (input: unknown) => {
      const { command } = input as { command: string };
      return { output: `Executed: ${command}` };
    },
  });

  // The approval callback. In a real app this would prompt the
  // user (CLI: readline, GUI: dialog, server: webhook). Here we
  // approve "ls" (safe) and deny everything else (unsafe).
  const onApprovalRequest = async (req: ApprovalRequest): Promise<ApprovalResult> => {
    const command = (req.input as { command?: string })?.command ?? '';
    const cmd = command.split(' ')[0] ?? '';
    const safe = cmd === 'ls' || cmd === 'cat' || cmd === 'echo';
    console.log(`  [approval] '${command}' — ${safe ? 'APPROVED' : 'DENIED'}`);
    return {
      approved: safe,
      reason: safe ? undefined : `Command '${cmd}' is not in the safe set (ls, cat, echo).`,
    };
  };

  const provider = new DemoProvider([
    { toolName: 'bash', input: { command: 'ls /tmp' } }, // will be approved
    { toolName: 'bash', input: { command: 'rm -rf /' } }, // will be denied
  ]);

  const agent = new Agent({ model: provider, tools: [bash], onApprovalRequest });

  console.log('→ Running agent on fake prompt that calls Bash twice...\n');

  const result = await agent.run('List /tmp, then clean up');
  console.log(`\n→ Final output: ${result.output}`);
  console.log(`→ Iterations:   ${result.iterations}`);

  // Also stream a summary of what happened for the demo
  for (const call of [
    { command: 'ls /tmp', approved: true },
    { command: 'rm -rf /', approved: false },
  ]) {
    const status = call.approved ? 'OK' : 'DENIED';
    console.log(`  [${status}] bash: ${call.command}`);
  }
}

/** Fake provider: emits pre-canned tool_use calls then an end_turn. */
class DemoProvider implements Provider {
  readonly name = 'demo';
  readonly model = 'demo-1';
  private index = 0;
  constructor(
    private readonly calls: readonly { toolName: string; input: Record<string, unknown> }[],
  ) {}

  async chat(_req: ChatRequest) {
    const call = this.calls[this.index++];
    if (!call) {
      return {
        message: { role: 'assistant' as const, content: 'I see the second command was denied.' },
        usage: { inputTokens: 1, outputTokens: 1 },
        stopReason: 'end_turn' as const,
        model: 'demo-1',
      };
    }
    return {
      message: {
        role: 'assistant' as const,
        content: [
          {
            type: 'tool_use' as const,
            id: `tu_${this.index}`,
            name: call.toolName,
            input: call.input,
          },
        ],
      },
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: 'tool_use' as const,
      model: 'demo-1',
    };
  }

  async *stream(_req: ChatRequest) {
    // Not used — chat() is enough for this example.
    yield {
      type: 'message_end' as const,
      stopReason: 'end_turn' as const,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
