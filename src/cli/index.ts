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
import { defaultCliApprovalPrompt } from './approval-prompt.js';
import { type InitOptions, initCommand } from './init.js';

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

  if (subcommand === 'init') {
    await initCliCommand();
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
      stream: { type: 'boolean' },
      'no-approval': { type: 'boolean' },
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
    ...(values['no-approval'] ? {} : { onApprovalRequest: defaultCliApprovalPrompt() }),
  });

  if (values.stream) {
    // Streaming path. Text deltas go straight to stdout; tool calls
    // and results are logged to stderr (so they don't pollute the
    // streamed output if the user pipes it through grep / awk).
    for await (const event of agent.streamRun(prompt)) {
      if (event.type === 'text') {
        process.stdout.write(event.text);
      } else if (event.type === 'tool_call_start') {
        // eslint-disable-next-line no-console
        console.error(`\n[tool] ${event.name} (${event.id})`);
      } else if (event.type === 'tool_result') {
        const preview = event.result.output.slice(0, 80).replace(/\n/g, ' ');
        // eslint-disable-next-line no-console
        console.error(
          `[tool-result] ${event.name}: ${preview}${event.result.output.length > 80 ? '...' : ''}`,
        );
      } else if (event.type === 'done') {
        // eslint-disable-next-line no-console
        console.error(
          `\n[done] ${event.iterations} iteration(s), ${event.usage.inputTokens} in / ${event.usage.outputTokens} out tokens`,
        );
      } else if (event.type === 'error') {
        // eslint-disable-next-line no-console
        console.error(`\n[error] ${event.message}`);
        process.exit(1);
      }
    }
    process.exit(0);
  }

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

/**
 * `husk init <dir>` — scaffold a new Husk project.
 *
 * Flags:
 *   --provider <name>         'anthropic' (default) or 'openai'
 *   --template <name>         'minimal' (default) or 'full' (adds code-reviewer example)
 *   --install                 Auto-run the detected package manager's install
 *   --git                     Auto-init a git repo and create an initial commit
 *   --git-author "Name <e>"   Override committer identity for the initial commit
 *   --package-manager <name>  'npm' | 'pnpm' | 'bun' | 'yarn' (default: detected)
 *   --force                   Overwrite existing files in the target dir
 *   --no-interactive          Skip all prompts (default in CI / non-TTY)
 *   --skip-install            Alias for the absence of --install (placeholder)
 *   -h, --help                Show init-specific help
 */
async function initCliCommand(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(3),
    options: {
      provider: { type: 'string' },
      template: { type: 'string' },
      install: { type: 'boolean' },
      git: { type: 'boolean' },
      'git-author': { type: 'string' },
      'package-manager': { type: 'string' },
      force: { type: 'boolean' },
      'non-interactive': { type: 'boolean' },
      'skip-install': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    // eslint-disable-next-line no-console
    console.log(`husk init — scaffold a new Husk project

Usage:
  husk init <dir> [options]

Options:
  --provider <name>         'anthropic' (default) or 'openai'
  --template <name>         'minimal' (default) or 'full' (adds code-reviewer example)
  --install                 Auto-run the detected package manager's install
  --git                     Auto-init a git repo and create an initial commit
  --git-author "Name <e>"   Override committer identity for the initial commit
  --package-manager <name>  'npm' | 'pnpm' | 'bun' | 'yarn' (default: detected)
  --force                   Overwrite existing files in the target dir
  --non-interactive         Skip all prompts (default in CI / non-TTY)
  --skip-install            Alias for the absence of --install (placeholder)

Examples:
  husk init my-agent
  husk init my-agent --provider openai
  husk init my-agent --template full
  husk init my-agent --git --install           # git + npm install in one go
  husk init my-agent --force                   # overwrite an existing dir
  husk init my-agent --non-interactive         # CI / scripted use
`);
    return;
  }

  const target = positionals[0] ?? process.argv[3];
  if (!target) {
    // eslint-disable-next-line no-console
    console.error('Error: husk init requires a target directory.');
    // eslint-disable-next-line no-console
    console.error('Usage: husk init <dir> [options]');
    process.exit(2);
  }

  const provider = (values.provider ?? 'anthropic') as InitOptions['provider'];
  if (provider !== 'anthropic' && provider !== 'openai') {
    // eslint-disable-next-line no-console
    console.error(`Error: unknown provider '${provider}'. Use 'anthropic' or 'openai'.`);
    process.exit(2);
  }

  const template = (values.template ?? 'minimal') as InitOptions['template'];
  if (template !== 'minimal' && template !== 'full') {
    // eslint-disable-next-line no-console
    console.error(`Error: unknown template '${template}'. Use 'minimal' or 'full'.`);
    process.exit(2);
  }

  // Install / skip-install are explicit opt-ins / opt-outs. --install
  // wins if both are passed (the user clearly meant "do it").
  const installFlag = values.install ? true : values['skip-install'] ? false : undefined;
  // Force: true if --force, 'prompt' if neither --force nor --non-interactive
  // is passed (TTY will prompt, non-TTY falls through to the gate that
  // throws if the target isn't empty), false if --non-interactive is passed.
  const forceFlag: InitOptions['force'] = values.force
    ? true
    : values['non-interactive']
      ? false
      : 'prompt';
  const noInteractive = values['non-interactive'] === true;

  const result = await initCommand({
    target,
    provider,
    template,
    ...(installFlag !== undefined ? { install: installFlag } : {}),
    ...(values.git ? { git: true } : {}),
    ...(values['git-author'] ? { gitAuthor: String(values['git-author']) } : {}),
    ...(values['package-manager']
      ? { packageManager: values['package-manager'] as InitOptions['packageManager'] }
      : {}),
    force: forceFlag,
    ...(noInteractive ? { noInteractive: true } : {}),
  });

  // eslint-disable-next-line no-console
  console.log(`\n✓ Scaffolded ${result.template} Husk project at ${result.projectDir}`);
  // eslint-disable-next-line no-console
  console.log(`  Provider:        ${result.provider}`);
  // eslint-disable-next-line no-console
  console.log(`  Package manager: ${result.packageManager}`);
  // eslint-disable-next-line no-console
  console.log(`  Files created:   ${result.files.length}`);
  for (const f of result.files) {
    // eslint-disable-next-line no-console
    console.log(`    - ${f}`);
  }
  if (result.installExitCode !== undefined) {
    // eslint-disable-next-line no-console
    console.log(
      `  Install:         ${result.installExitCode === 0 ? 'success' : `failed (exit ${result.installExitCode})`}`,
    );
  }
  if (result.gitExitCode !== undefined) {
    // eslint-disable-next-line no-console
    console.log(
      `  Git init:        ${result.gitExitCode === 0 ? 'success' : `failed (exit ${result.gitExitCode})`}`,
    );
  }
  // eslint-disable-next-line no-console
  console.log('\nNext steps:');
  // eslint-disable-next-line no-console
  console.log(`  cd ${result.projectDir}`);
  // eslint-disable-next-line no-console
  console.log('  cp .env.example .env  # then paste your API key');
  // eslint-disable-next-line no-console
  console.log('  npm install            # or pnpm / bun');
  // eslint-disable-next-line no-console
  console.log('  npm start              # runs src/hello-agent.ts');
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`husk — run an agent, eval suite, or scaffold a new project

Usage:
  husk run "<prompt>" [options]
  husk eval <file-or-dir>
  husk init <dir> [options]

Run options:
  --model <id>       Model id (default: claude-opus-4-6)
  --provider <name>  'anthropic' (default) or 'openai'
  --tools <list>     Comma-separated tool names: read,write,edit,bash,grep
                     (default: all five)
  --memory <kind>    'in-memory' (default) or 'file'
  --max <n>          Max agent iterations (default: 25)
  --stream           Stream the response token-by-token (requires provider.stream())
  --no-approval      Block all tools that have requireApproval: true
                     (default: prompt on stderr/stdin)
  -h, --help         Show this help
  -v, --version      Show version

Eval options:
  <file>             A .ts/.js/.mjs file exporting one or more EvalSuite
  <dir>              A directory; all *.ts/*.js/*.mjs files are loaded

Init options:
  --provider <name>         'anthropic' (default) or 'openai'
  --template <name>         'minimal' (default) or 'full' (adds code-reviewer example)
  --install                 Auto-run the detected package manager's install
  --git                     Auto-init a git repo and create an initial commit
  --git-author "Name <e>"   Override committer identity for the initial commit
  --package-manager <name>  'npm' | 'pnpm' | 'bun' | 'yarn' (default: detected)
  --force                   Overwrite existing files in the target dir
  --non-interactive         Skip all prompts (default in CI / non-TTY)

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
  husk init my-agent
  husk init my-agent --provider openai --template full
`);
}

const VERSION = '0.5.0';

await main();
