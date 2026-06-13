/**
 * Husk — minimal CLI.
 *
 * v0.1.0 ships 'husk run'. v0.3.0 adds 'husk eval <file-or-dir>' for
 * running eval suites from the terminal (CI integration).
 *
 * Usage:
 *   husk run "What is the capital of France?" --model claude-opus-4-6
 *   husk run "Refactor src/foo.ts" --tools read,write,edit,bash,grep
 *   husk eval ./evals/geography.ts
 *   husk eval ./evals/           # runs all *.eval.{ts,js} in the dir
 *   husk --help
 *
 * Configuration:
 *   ANTHROPIC_API_KEY    required for Anthropic provider
 *   OPENAI_API_KEY       required for OpenAI provider
 *   HUSK_MODEL           default model id (default: claude-opus-4-6)
 *   HUSK_PROVIDER        'anthropic' (default) or 'openai'
 */

import { existsSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  Agent,
  AnthropicProvider,
  Bash,
  Edit,
  type EvalSuite,
  FileStore,
  Grep,
  InMemoryStore,
  OpenAIProvider,
  Read,
  type SuiteResult,
  type ToolDefinition,
  Write,
  runSuite,
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

  if (subcommand === 'eval') {
    await evalCommand();
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

  const prompt = process.argv[3];
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
  const tools: ToolDefinition[] = toolNames.map((name) => {
    const t = TOOL_REGISTRY[name as keyof typeof TOOL_REGISTRY];
    if (!t) {
      // eslint-disable-next-line no-console
      console.error(
        `Error: unknown tool '${name}'. Available: ${Object.keys(TOOL_REGISTRY).join(', ')}`,
      );
      process.exit(1);
    }
    return t as ToolDefinition;
  });

  const memory = values.memory === 'file' ? new FileStore() : new InMemoryStore();
  const maxIterations = values.max ? Number.parseInt(values.max, 10) : 25;

  const agent = new Agent({
    model: provider,
    ...(tools.length > 0 ? { tools: tools as readonly ToolDefinition[] } : {}),
    memory,
    maxIterations,
  });

  const result = await agent.run(prompt);

  // eslint-disable-next-line no-console
  console.log(result.output);
  process.exit(0);
}

/**
 * `husk eval <file-or-dir>` — run eval suites from the terminal.
 *
 * Accepts a single .ts/.js/.mjs file or a directory (runs all .ts/.js/.mjs
 * files inside). For .ts files, requires tsx in the user's project
 * (we document this in the README). For .js/.mjs files, works out of
 * the box.
 *
 * Exit codes:
 *   0  all suites passed
 *   1  at least one suite or case failed
 *   2  usage error (missing file, no suites found, etc.)
 */
async function evalCommand(): Promise<void> {
  const target = process.argv[3];
  if (!target) {
    // eslint-disable-next-line no-console
    console.error('Error: husk eval requires a path argument.');
    // eslint-disable-next-line no-console
    console.error('Usage: husk eval <file-or-dir>');
    process.exit(2);
  }

  const resolved = resolve(target);
  if (!existsSync(resolved)) {
    // eslint-disable-next-line no-console
    console.error(`Error: path not found: ${resolved}`);
    process.exit(2);
  }

  // Collect files
  const stat = statSync(resolved);
  const files: string[] = [];
  if (stat.isDirectory()) {
    const entries = await readdir(resolved, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      const ext = extname(e.name);
      if (ext === '.ts' || ext === '.js' || ext === '.mjs') {
        files.push(resolve(resolved, e.name));
      }
    }
  } else {
    files.push(resolved);
  }

  if (files.length === 0) {
    // eslint-disable-next-line no-console
    console.error(`Error: no .ts/.js/.mjs files found in ${resolved}`);
    process.exit(2);
  }

  let totalPassed = 0;
  let totalCases = 0;
  let anyFailed = false;

  for (const file of files) {
    // eslint-disable-next-line no-console
    console.log(`\n=== ${file} ===`);
    try {
      // Dynamic import. For .ts files, the user must have 'tsx' in
      // their dev deps. We document this in the README.
      const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      // Look for exported EvalSuite (or array of them)
      const suites: EvalSuite[] = [];
      for (const value of Object.values(mod)) {
        if (
          value &&
          typeof value === 'object' &&
          'name' in value &&
          'cases' in value &&
          Array.isArray((value as EvalSuite).cases)
        ) {
          suites.push(value as EvalSuite);
        }
      }
      if (suites.length === 0) {
        // eslint-disable-next-line no-console
        console.error(`  No EvalSuite found in ${file}`);
        continue;
      }
      for (const suite of suites) {
        // For the CLI, we use a default Anthropic provider unless
        // the user has set env vars. Eval files that need a custom
        // agent factory should call runSuite themselves in a script
        // — the CLI is a thin wrapper for the common case.
        const factory = () => Promise.resolve(makeDefaultAgent());
        const result: SuiteResult = await runSuite(suite, factory);
        totalPassed += result.passed;
        totalCases += result.total;
        for (const r of result.results) {
          const icon = r.passed ? '✓' : '✗';
          // eslint-disable-next-line no-console
          console.log(`  ${icon} ${r.caseName}`);
          if (!r.passed) {
            anyFailed = true;
            for (const a of r.assertionResults) {
              // eslint-disable-next-line no-console
              console.log(`     ✗ ${a.name}: ${a.message ?? 'failed'}`);
            }
          }
        }
        // eslint-disable-next-line no-console
        console.log(`  ${result.passed}/${result.total} passed in ${result.durationMs}ms`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`  Error loading ${file}: ${message}`);
      anyFailed = true;
    }
  }

  // eslint-disable-next-line no-console
  console.log(`\n=== Total: ${totalPassed}/${totalCases} cases passed ===`);
  process.exit(anyFailed ? 1 : 0);
}

function makeDefaultAgent(): Agent {
  const providerName = process.env.HUSK_PROVIDER ?? 'anthropic';
  const modelId = process.env.HUSK_MODEL ?? 'claude-opus-4-6';
  const provider =
    providerName === 'openai'
      ? new OpenAIProvider({ model: modelId, apiKey: process.env.OPENAI_API_KEY })
      : new AnthropicProvider({ model: modelId, apiKey: process.env.ANTHROPIC_API_KEY });
  return new Agent({ model: provider });
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`husk — run an agent or eval suite from the command line

Usage:
  husk run "<prompt>" [options]
  husk eval <file-or-dir>

Run options:
  --model <id>       Model id (default: claude-opus-4-6)
  --provider <name>  'anthropic' (default) or 'openai'
  --tools <list>     Comma-separated tool names: read,write,edit,bash,grep
                     (default: all five)
  --memory <kind>    'in-memory' (default) or 'file'
  --max <n>          Max agent iterations (default: 25)
  -h, --help         Show this help
  -v, --version      Show version

Eval options:
  <file>             A .ts/.js/.mjs file exporting one or more EvalSuite
  <dir>              A directory; all *.ts/*.js/*.mjs files are loaded

Environment:
  ANTHROPIC_API_KEY   Required for Anthropic provider
  OPENAI_API_KEY      Required for OpenAI provider
  HUSK_MODEL          Override default model
  HUSK_PROVIDER       Override default provider

Examples:
  husk run "What is the capital of France?"
  husk run "Refactor src/foo.ts" --tools read,edit,write
  husk run "Summarize README.md" --provider openai --model gpt-5
  husk eval ./evals/geography.ts
`);
}

const VERSION = '0.3.0-dev.0';

await main();
