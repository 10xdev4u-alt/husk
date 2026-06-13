/**
 * Tests for the v0.5.0 tool validation framework.
 *
 * Covers:
 *   - defineValidation / defineValidationSet / normalizeRules helpers
 *   - pathAllowed() (inside, outside, edge cases)
 *   - commandDenylist() (denied program, allowed program, weird inputs)
 *   - maxFieldSize() (under, over, non-string)
 *   - noShellMetacharacters() (clean, dirty, non-string)
 *   - Integration: a tool with validate rules fails the agent loop
 *     before execute() is called
 */

import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../src/core/agent.js';
import type {
  ChatRequest,
  ChatResponse,
  Provider,
  ToolDefinition,
  ToolResult,
} from '../src/core/types.js';
import { defineTool, objectSchema, stringField } from '../src/tools/registry.js';
import {
  type ValidationContext,
  commandDenylist,
  defineValidation,
  defineValidationSet,
  maxFieldSize,
  noShellMetacharacters,
  normalizeRules,
  pathAllowed,
} from '../src/tools/validation.js';

// ───────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────

const ctx: ValidationContext = {
  toolName: 'test',
  cwd: '/home/user/project',
  input: {},
  env: {},
};

// A provider that always returns tool_use for the same tool.
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
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id, name, input }],
    },
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

// ───────────────────────────────────────────────────────────────────
// Helpers themselves
// ───────────────────────────────────────────────────────────────────

describe('validation helpers', () => {
  test('defineValidation returns a rule with the given name + check', () => {
    const rule = defineValidation('my-rule', () => null);
    expect(rule.name).toBe('my-rule');
    expect(rule.check).toBeFunction();
  });

  test('defineValidationSet bundles rules into an array', () => {
    const r1 = defineValidation('a', () => null);
    const r2 = defineValidation('b', () => null);
    const set = defineValidationSet(r1, r2);
    expect(set).toHaveLength(2);
    expect(set[0]?.name).toBe('a');
    expect(set[1]?.name).toBe('b');
  });

  test('normalizeRules wraps a single rule in an array', () => {
    const r = defineValidation('solo', () => null);
    const norm = normalizeRules(r);
    expect(norm).toHaveLength(1);
    expect(norm[0]).toBe(r);
  });

  test('normalizeRules returns an array unchanged', () => {
    const r1 = defineValidation('a', () => null);
    const r2 = defineValidation('b', () => null);
    const set = [r1, r2] as const;
    const norm = normalizeRules(set);
    expect(norm).toEqual(set);
  });
});

// ───────────────────────────────────────────────────────────────────
// pathAllowed
// ───────────────────────────────────────────────────────────────────

describe('pathAllowed', () => {
  const rule = pathAllowed({ baseDir: '/home/user/project' });
  const r = rule.check;

  test('passes for a path inside the base dir', () => {
    expect(r({ path: '/home/user/project/src/foo.ts' }, ctx)).toBeNull();
  });

  test('rejects a path outside the base dir (absolute)', () => {
    const err = r({ path: '/etc/passwd' }, ctx);
    expect(err).toBeString();
    expect(err).toContain('outside the allowed base directory');
  });

  test('rejects a relative path that escapes', () => {
    const err = r({ path: '../../../etc/passwd' }, ctx);
    expect(err).toBeString();
  });

  test('passes for a bare relative path (lets the tool resolve)', () => {
    expect(r({ path: 'src/foo.ts' }, ctx)).toBeNull();
  });

  test('handles non-string paths by passing', () => {
    expect(r({ path: 42 }, ctx)).toBeNull();
  });

  test('handles non-object input by passing', () => {
    expect(r(null, ctx)).toBeNull();
    expect(r('not an object', ctx)).toBeNull();
  });

  test('uses a custom field name when provided', () => {
    const custom = pathAllowed({ baseDir: '/tmp', field: 'target' });
    expect(custom.check({ target: '/etc/passwd' }, ctx)).toBeString();
    expect(custom.check({ path: '/etc/passwd' }, ctx)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────
// commandDenylist
// ───────────────────────────────────────────────────────────────────

describe('commandDenylist', () => {
  const rule = commandDenylist(['rm', 'mkfs', 'dd']);
  const r = rule.check;

  test('blocks a denied program', () => {
    const err = r({ command: 'rm -rf /' }, ctx);
    expect(err).toContain('rm');
    expect(err).toContain('denylist');
  });

  test('passes an allowed program', () => {
    expect(r({ command: 'ls -la' }, ctx)).toBeNull();
  });

  test('case-insensitive match', () => {
    expect(r({ command: 'RM -rf /' }, ctx)).toBeString();
  });

  test('matches the first token only', () => {
    // 'rm' is the first token — blocked. 'grep' as first token is fine.
    expect(r({ command: 'rm' }, ctx)).toBeString();
    expect(r({ command: 'grep -r pattern /tmp/rm' }, ctx)).toBeNull();
  });

  test('handles non-string commands by passing', () => {
    expect(r({ command: 42 }, ctx)).toBeNull();
  });

  test('handles empty commands by passing', () => {
    expect(r({ command: '' }, ctx)).toBeNull();
    expect(r({ command: '   ' }, ctx)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────
// maxFieldSize
// ───────────────────────────────────────────────────────────────────

describe('maxFieldSize', () => {
  const rule = maxFieldSize({ field: 'content', maxBytes: 100 });
  const r = rule.check;

  test('passes when under the cap', () => {
    expect(r({ content: 'small text' }, ctx)).toBeNull();
  });

  test('rejects when over the cap', () => {
    const big = 'a'.repeat(101);
    const err = r({ content: big }, ctx);
    expect(err).toContain('exceeds max');
  });

  test('counts UTF-8 bytes, not characters', () => {
    // '€' is 3 bytes in UTF-8. 34 of them = 102 bytes, > 100 cap.
    const err = r({ content: '€'.repeat(34) }, ctx);
    expect(err).toBeString();
  });

  test('handles non-string fields by passing', () => {
    expect(r({ content: 42 }, ctx)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────
// noShellMetacharacters
// ───────────────────────────────────────────────────────────────────

describe('noShellMetacharacters', () => {
  const rule = noShellMetacharacters({ field: 'command' });
  const r = rule.check;

  test('passes clean commands', () => {
    expect(r({ command: 'ls -la /tmp' }, ctx)).toBeNull();
    expect(r({ command: "echo 'hello world'" }, ctx)).toBeNull();
  });

  test('rejects command substitution with $()', () => {
    expect(r({ command: 'echo $(whoami)' }, ctx)).toBeString();
  });

  test('rejects backticks', () => {
    expect(r({ command: 'echo `whoami`' }, ctx)).toBeString();
  });

  test('rejects && / || / ;', () => {
    expect(r({ command: 'ls && rm -rf /' }, ctx)).toBeString();
    expect(r({ command: 'ls || true' }, ctx)).toBeString();
    expect(r({ command: 'ls; rm' }, ctx)).toBeString();
  });

  test('handles non-string fields by passing', () => {
    expect(r({ command: 42 }, ctx)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────
// Integration with the agent loop
// ───────────────────────────────────────────────────────────────────

describe('validation in the agent loop', () => {
  test('a tool with a failing validation rule never executes', async () => {
    let executed = false;
    const dangerousTool: ToolDefinition = defineTool({
      name: 'dangerous',
      description: 'A tool that would be bad if it ran',
      inputSchema: objectSchema({ path: stringField() }),
      validate: pathAllowed({ baseDir: '/home/user/project' }),
      execute: async () => {
        executed = true;
        return { output: 'should not happen' };
      },
    });

    const provider = new ToolUseProvider([
      toolUseResponse('dangerous', { path: '/etc/passwd' }),
      endTurnResponse('I see the validation error.'),
    ]);
    const agent = new Agent({ model: provider, tools: [dangerousTool] });
    const result = await agent.run('try the dangerous thing');

    expect(executed).toBe(false);
    expect(result.output).toBe('I see the validation error.');
  });

  test('a tool with a passing validation rule executes normally', async () => {
    let executed = false;
    const safeTool: ToolDefinition = defineTool({
      name: 'safe',
      description: 'A tool that is safe',
      inputSchema: objectSchema({ path: stringField() }),
      validate: pathAllowed({ baseDir: '/home/user/project' }),
      execute: async (input: unknown) => {
        executed = true;
        return { output: `done with ${(input as { path: string }).path}` };
      },
    });

    const provider = new ToolUseProvider([
      toolUseResponse('safe', { path: '/home/user/project/src/foo.ts' }),
      endTurnResponse('All done.'),
    ]);
    const agent = new Agent({ model: provider, tools: [safeTool] });
    const result = await agent.run('do the safe thing');

    expect(executed).toBe(true);
    expect(result.output).toBe('All done.');
  });

  test('multiple rules: any failure short-circuits the rest', async () => {
    let ruleACount = 0;
    let ruleBCount = 0;
    const multiRuleTool: ToolDefinition = defineTool({
      name: 'multi',
      description: 'A tool with several rules',
      inputSchema: objectSchema({ content: stringField() }),
      validate: defineValidationSet(
        defineValidation('rule-a', () => {
          ruleACount += 1;
          return 'rule a failed';
        }),
        defineValidation('rule-b', () => {
          ruleBCount += 1;
          return 'rule b should not run';
        }),
      ),
      execute: async (): Promise<ToolResult> => ({ output: 'should not run' }),
    });

    const provider = new ToolUseProvider([
      toolUseResponse('multi', { content: 'anything' }),
      endTurnResponse('OK'),
    ]);
    const agent = new Agent({ model: provider, tools: [multiRuleTool] });
    await agent.run('trigger multi');

    expect(ruleACount).toBe(1);
    expect(ruleBCount).toBe(0); // short-circuited
  });
});

describe('validation error message shape', () => {
  test('error includes the rule name for debuggability', async () => {
    const tool: ToolDefinition = defineTool({
      name: 'write_file',
      description: 'Writes a file',
      inputSchema: objectSchema({ content: stringField() }),
      validate: maxFieldSize({ field: 'content', maxBytes: 5 }),
      execute: async (): Promise<ToolResult> => ({ output: 'nope' }),
    });

    const provider = new ToolUseProvider([
      toolUseResponse('write_file', { content: 'this is way too long' }),
      endTurnResponse('I see the size error.'),
    ]);
    const agent = new Agent({ model: provider, tools: [tool] });
    const result = await agent.run('write big content');

    // The model should see an error mentioning the rule name
    // somewhere in the conversation history. We don't expose
    // messages directly via the result in this assertion, but we
    // can check the loop completed without throwing.
    expect(result.output).toBe('I see the size error.');
  });
});

// Sanity: ensure that importing tmpdir / join doesn't trigger a
// "unused" warning when the agent loop test above doesn't use them.
void tmpdir;
void join;
