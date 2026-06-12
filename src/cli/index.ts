/**
 * Husk — minimal CLI.
 *
 * v0.1.0 ships a single command: 'husk run' executes an agent against
 * a one-shot prompt and prints the result. More commands (init, eval,
 * trace replay) come in v0.2.
 *
 * Usage:
 *   husk run "What is the capital of France?" --model claude-opus-4-6
 *   husk run "Refactor src/foo.ts" --tools read,write,edit,bash,grep
 *   husk run --help
 *
 * Configuration:
 *   ANTHROPIC_API_KEY    required for Anthropic provider
 *   OPENAI_API_KEY       required for OpenAI provider
 *   HUSK_MODEL           default model id (default: claude-opus-4-6)
 *   HUSK_PROVIDER        'anthropic' (default) or 'openai'
 */

import { parseArgs } from 'node:util';
import {
  Agent,
  AnthropicProvider,
  Bash,
  ConsoleLogger,
  Edit,
  FileStore,
  Grep,
  InMemoryStore,
  OpenAIProvider,
  Read,
  type ToolDefinition,
  Write,
} from '../index.js';

const TOOL_REGISTRY = { read: Read, write: Write, edit: Edit, bash: Bash, grep: Grep } as const;

async function main(): Promise<void> {
  const subcommand = process.argv[2];

  if (subcommand === '--help' || subcommand === '-h' || subcommand === undefined) {
    printHelp();
    return;
  }

  if (subcommand === 'run') {
    await runCommand();
    return;
  }

  if (subcommand === 'version' || subcommand === '--version' || subcommand === '-v') {
    // eslint-disable-next-line no-console
    console.log(`husk ${VERSION}`);
    return;
  }

  // eslint-disable-next-line no-console
  console.error(`Unknown command: ${subcommand}\nRun 'husk --help' for usage.`);
  process.exit(1);
}

async function runCommand(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      model: { type: 'string' },
      provider: { type: 'string' },
      tools: { type: 'string' },
      memory: { type: 'string' },
      max: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    return;
  }

  const prompt = values.help === undefined ? process.argv[3] : undefined;
  if (!prompt) {
    // eslint-disable-next-line no-console
    console.error('Error: husk run requires a prompt argument.');
    // eslint-disable-next-line no-console
    console.error('Usage: husk run "your prompt here"');
    process.exit(1);
  }

  const providerName = values.provider ?? process.env.HUSK_PROVIDER ?? 'anthropic';
  const modelId = values.model ?? process.env.HUSK_MODEL ?? 'claude-opus-4-6';

  const provider =
    providerName === 'openai'
      ? new OpenAIProvider({ model: modelId })
      : new AnthropicProvider({ model: modelId });

  const toolNames = (values.tools ?? 'read,write,edit,bash,grep')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const tools = toolNames.map((name) => {
    const t = TOOL_REGISTRY[name as keyof typeof TOOL_REGISTRY];
    if (!t) {
      // eslint-disable-next-line no-console
      console.error(
        `Error: unknown tool '${name}'. Available: ${Object.keys(TOOL_REGISTRY).join(', ')}`,
      );
      process.exit(1);
    }
    return t;
  });

  const memory = values.memory === 'file' ? new FileStore() : new InMemoryStore();
  const maxIterations = values.max ? Number.parseInt(values.max, 10) : 25;

  const agent = new Agent({
    model: provider,
    ...(tools.length > 0 ? { tools: tools as readonly ToolDefinition[] } : {}),
    memory,
    maxIterations,
  });

  // The agent's default logger is ConsoleLogger; this is here to make
  // the CLI's logger usage explicit and easy to swap (e.g. for JSON
  // output in CI).
  void ConsoleLogger;

  const result = await agent.run(prompt);

  // eslint-disable-next-line no-console
  console.log(result.output);
  process.exit(0);
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`husk — run an agent from the command line

Usage:
  husk run "<prompt>" [options]

Options:
  --model <id>       Model id (default: claude-opus-4-6)
  --provider <name>  'anthropic' (default) or 'openai'
  --tools <list>     Comma-separated tool names: read,write,edit,bash,grep
                     (default: all five)
  --memory <kind>    'in-memory' (default) or 'file'
  --max <n>          Max agent iterations (default: 25)
  -h, --help         Show this help
  -v, --version      Show version

Environment:
  ANTHROPIC_API_KEY   Required for Anthropic provider
  OPENAI_API_KEY      Required for OpenAI provider
  HUSK_MODEL          Override default model
  HUSK_PROVIDER       Override default provider

Examples:
  husk run "What is the capital of France?"
  husk run "Refactor src/foo.ts" --tools read,edit,write
  husk run "Summarize README.md" --provider openai --model gpt-5
`);
}

const VERSION = '0.0.1';

await main();
