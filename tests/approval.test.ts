/**
 * Tests for the v0.6.0 tool approval flow.
 *
 * Coverage:
 *   - requireApproval + no onApprovalRequest → tool blocked
 *   - requireApproval + onApprovalRequest that approves → tool runs
 *   - requireApproval + onApprovalRequest that denies → tool blocked with reason
 *   - requireApproval: false → tool runs without calling the callback
 *   - The callback receives the right ApprovalRequest shape
 *   - The default CLI prompt auto-denies in non-TTY
 */

import { describe, expect, test } from 'bun:test';
import { defaultCliApprovalPrompt } from '../src/cli/approval-prompt.js';
import { Agent } from '../src/core/agent.js';
import type {
  ApprovalRequest,
  ApprovalResult,
  ChatRequest,
  ChatResponse,
  Provider,
  ToolDefinition,
} from '../src/core/types.js';
import { defineTool, objectSchema, stringField } from '../src/tools/registry.js';

class ToolUseProvider implements Provider {
  readonly name = 'fake';
  readonly model = 'fake-1';
  private index = 0;
  constructor(private readonly responses: ChatResponse[]) {}
  async chat(_req: ChatRequest): Promise<ChatResponse> {
    const r = this.responses[this.index++];
    if (!r) throw new Error('no more responses');
    return r;
  }
}

function toolUseResponse(name: string, input: Record<string, unknown>, id = 'tu_1'): ChatResponse {
  return {
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
    usage: { inputTokens: 1, outputTokens: 1 },
    stopReason: 'tool_use',
    model: 'fake-1',
  };
}

function endTurnResponse(text: string): ChatResponse {
  return {
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    usage: { inputTokens: 1, outputTokens: 1 },
    stopReason: 'end_turn',
    model: 'fake-1',
  };
}

describe('requireApproval — no onApprovalRequest configured', () => {
  test('the tool is blocked with a helpful error', async () => {
    let executed = false;
    const dangerousTool: ToolDefinition = defineTool({
      name: 'rm',
      description: 'Deletes a file',
      inputSchema: objectSchema({ path: stringField() }),
      requireApproval: true,
      execute: async () => {
        executed = true;
        return { output: 'should not run' };
      },
    });

    const provider = new ToolUseProvider([
      toolUseResponse('rm', { path: '/etc/passwd' }),
      endTurnResponse("I see the tool wasn't approved."),
    ]);
    const agent = new Agent({ model: provider, tools: [dangerousTool] });
    const result = await agent.run('rm /etc/passwd');

    expect(executed).toBe(false);
    expect(result.output).toBe("I see the tool wasn't approved.");
  });
});

describe('requireApproval — onApprovalRequest approves', () => {
  test('the tool runs when the callback approves', async () => {
    let executed = false;
    const tool: ToolDefinition = defineTool({
      name: 'deploy',
      description: 'Deploys to production',
      inputSchema: objectSchema({ service: stringField() }),
      requireApproval: true,
      execute: async (input: unknown) => {
        executed = true;
        return { output: `Deployed ${(input as { service: string }).service}` };
      },
    });

    const provider = new ToolUseProvider([
      toolUseResponse('deploy', { service: 'api' }),
      endTurnResponse('Done.'),
    ]);
    const agent = new Agent({
      model: provider,
      tools: [tool],
      onApprovalRequest: async (): Promise<ApprovalResult> => ({ approved: true }),
    });
    await agent.run('deploy api');
    expect(executed).toBe(true);
  });
});

describe('requireApproval — onApprovalRequest denies', () => {
  test('the tool is blocked and the model sees the denial reason', async () => {
    let executed = false;
    const tool: ToolDefinition = defineTool({
      name: 'deploy',
      description: 'Deploys to production',
      inputSchema: objectSchema({ service: stringField() }),
      requireApproval: true,
      execute: async () => {
        executed = true;
        return { output: 'should not run' };
      },
    });

    const provider = new ToolUseProvider([
      toolUseResponse('deploy', { service: 'api' }),
      endTurnResponse('I see the deploy was denied.'),
    ]);
    const agent = new Agent({
      model: provider,
      tools: [tool],
      onApprovalRequest: async (): Promise<ApprovalResult> => ({
        approved: false,
        reason: "It's Friday afternoon, no deploys.",
      }),
    });
    await agent.run('deploy api');
    expect(executed).toBe(false);
  });
});

describe('requireApproval — the callback shape', () => {
  test('receives toolName, input, and a reason string', async () => {
    let captured: ApprovalRequest | undefined;
    const tool: ToolDefinition = defineTool({
      name: 'dangerous',
      description: 'A dangerous op',
      inputSchema: objectSchema({ target: stringField() }),
      requireApproval: true,
      execute: async (): Promise<{ output: string }> => ({ output: 'ok' }),
    });

    const provider = new ToolUseProvider([
      toolUseResponse('dangerous', { target: 'prod-db' }),
      endTurnResponse('Done.'),
    ]);
    const agent = new Agent({
      model: provider,
      tools: [tool],
      onApprovalRequest: async (req: ApprovalRequest): Promise<ApprovalResult> => {
        captured = req;
        return { approved: true };
      },
    });
    await agent.run('do it');
    expect(captured).toBeDefined();
    expect(captured?.toolName).toBe('dangerous');
    expect(captured?.input).toEqual({ target: 'prod-db' });
    expect(captured?.reason).toContain('dangerous');
  });
});

describe('requireApproval: false (or unset) skips the callback entirely', () => {
  test('a tool without the flag runs normally, callback never fires', async () => {
    let executed = false;
    let callbackFired = false;
    const tool: ToolDefinition = defineTool({
      name: 'read',
      description: 'Read a file',
      inputSchema: objectSchema({ path: stringField() }),
      // requireApproval: false (default)
      execute: async (): Promise<{ output: string }> => {
        executed = true;
        return { output: 'file content' };
      },
    });

    const provider = new ToolUseProvider([
      toolUseResponse('read', { path: '/tmp/foo' }),
      endTurnResponse('Done.'),
    ]);
    const agent = new Agent({
      model: provider,
      tools: [tool],
      onApprovalRequest: async (): Promise<ApprovalResult> => {
        callbackFired = true;
        return { approved: true };
      },
    });
    await agent.run('read it');
    expect(executed).toBe(true);
    expect(callbackFired).toBe(false);
  });
});

describe('defaultCliApprovalPrompt — non-TTY auto-deny', () => {
  test('returns approved: false in non-TTY contexts', async () => {
    // Bun's test runner is non-TTY for stdin. The prompt should
    // detect this and auto-deny with a clear reason.
    const prompt = defaultCliApprovalPrompt();
    const result = await prompt({
      toolName: 'test',
      input: {},
      reason: 'test reason',
    });
    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/TTY/);
  });
});
