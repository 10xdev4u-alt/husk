/**
 * Example 08 — Tool validation framework.
 *
 * Builds a "safe file editor" agent that can read / write / edit
 * files, but only within a configurable project root. The model
 * can't escape via absolute paths or '..' traversal — every Write
 * is checked by pathAllowed() before it runs.
 *
 * Run it:
 *   bun run examples/08-validation/index.ts
 *
 * The demo is a smoke test (no API key needed). It builds an Agent
 * with one Write tool wrapped in pathAllowed, and shows:
 *   1. A path inside the project passes validation and runs.
 *   2. A path outside the project fails validation and is rejected.
 *
 * For a real agent loop, wrap AnthropicProvider / OpenAIProvider
 * the same way and pass it to new Agent({...}). The validation
 * layer is transparent to the model — it just sees 'your tool
 * call was blocked because...'.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../../src/core/agent.js';
import type { ChatRequest, Provider } from '../../src/core/types.js';
import { defineTool, objectSchema, stringField } from '../../src/tools/registry.js';
import { pathAllowed } from '../../src/tools/validation.js';

async function main() {
  // Set up a tmp project root and try a few paths.
  const projectRoot = await mkdtemp(join(tmpdir(), 'husk-validation-'));
  console.log(`\n→ Demo project root: ${projectRoot}\n`);

  // Define a Write tool that's gated to the project root.
  const safeWrite = defineTool({
    name: 'write_file',
    description: 'Writes content to a file within the project root',
    inputSchema: objectSchema({
      path: stringField({ description: 'Path to the file, relative to project root' }),
      content: stringField({ description: 'Content to write' }),
    }),
    validate: pathAllowed({ baseDir: projectRoot }),
    execute: async (input: unknown) => {
      const { path, content } = input as { path: string; content: string };
      const abs = join(projectRoot, path);
      await writeFile(abs, content, 'utf-8');
      return { output: `Wrote ${content.length} bytes to ${path}` };
    },
  });

  // Build a provider that emits two tool_use responses — one valid,
  // one malicious — and then an end_turn. Lets us see the validation
  // gate in action without spending tokens.
  const provider = new DemoProvider([
    {
      toolName: 'write_file',
      input: { path: 'src/hello.txt', content: 'Hello, validation!' },
    },
    {
      toolName: 'write_file',
      input: { path: '../../../etc/passwd', content: 'pwned' },
    },
  ]);

  const agent = new Agent({ model: provider, tools: [safeWrite] });
  console.log('→ Running agent on fake prompt that should call Write twice...\n');

  // Use run() (not streamRun) — the demo provider emits via chat(),
  // not stream(). The validation gate works identically either way.
  const result = await agent.run('Write a file, then try to escape');
  console.log(`\n→ Final output: ${result.output}`);
  console.log(`→ Iterations:   ${result.iterations}`);

  // Clean up.
  await rm(projectRoot, { recursive: true, force: true });
  console.log(`\n→ Cleaned up ${projectRoot}\n`);
}

/**
 * A demo provider that yields two pre-canned tool_use responses
 * followed by an end_turn. Used so the example runs without an
 * API key while still showing the full event flow.
 */
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
        message: { role: 'assistant' as const, content: 'I see the validation error.' },
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
    // Not used in this example — chat() is enough.
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
