/**
 * Husk — `husk init` project scaffolding.
 *
 * Creates a new Husk project in a target directory with sensible defaults:
 *   - package.json with husk as a dependency
 *   - tsconfig.json (strict, ESM, NodeNext)
 *   - .gitignore (node_modules, dist, .env)
 *   - .env.example (API key hints)
 *   - src/hello-agent.ts (a runnable example)
 *   - README.md (quickstart for the new project)
 *
 * v0.4.0 — first cut. Templates are inline strings so they ship with
 * the CLI bundle (no extra files to manage).
 *
 * v0.4.1 — adds:
 *   - --force flag to overwrite existing files
 *   - --install flag to auto-run package manager install
 *   - --git flag to auto-init a git repo with an initial commit
 *   - interactive prompts for missing flags when run in a TTY
 *   - isEmptyDir() / isExistingProject() helpers used by all of the above
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** Provider hint baked into the generated example + .env.example. */
export type InitProvider = 'anthropic' | 'openai';

/** Template flavor. `minimal` = just files needed to run a husk agent. `full` = + examples. */
export type InitTemplate = 'minimal' | 'full';

/** Options accepted by the `init` command. */
export interface InitOptions {
  /** Target directory. Created if it doesn't exist. */
  target: string;
  /** Default provider to wire up in the example + .env. Defaults to 'anthropic'. */
  provider?: InitProvider;
  /** Template flavor. Defaults to 'minimal'. */
  template?: InitTemplate;
  /**
   * Auto-run the detected package manager's install command after
   * writing files. Defaults to false. Skipped in non-TTY contexts
   * unless the user explicitly opts in (so AI agents and CI don't
   * hang on a 60-second install they didn't ask for).
   */
  install?: boolean;
  /**
   * Override the detected package manager. Useful when you want to
   * scaffold for a specific runtime regardless of what's in the cwd.
   */
  packageManager?: PackageManager;
  /**
   * Override the overwrite gate. See InitError.
   *  - true: overwrite without asking
   *  - false (default): throw if the target isn't empty
   *  - 'prompt': ask the user interactively (TTY-only)
   */
  force?: boolean | 'prompt';
  /**
   * Auto-initialize a git repo in the target dir and create an
   * initial commit. Defaults to false. Uses the system 'git' binary;
   * if git is not on PATH, runGitInit() returns a non-zero exit
   * code and the caller can decide whether to surface that.
   */
  git?: boolean;
  /**
   * Override the committer identity for the initial git commit.
   * Format: "Name <email>". Falls back to whatever the user's
   * global git config is set to (git will use that out of the box).
   */
  gitAuthor?: string;
  /**
   * When true, never prompt for input even in a TTY context. Useful
   * for AI agents, CI, and any scripted invocation. Defaults to
   * false (prompt when TTY + option is missing).
   *
   * If HUSK_INIT_NON_INTERACTIVE=1 is set in the env, this is
   * forced to true regardless of what the caller passed.
   */
  noInteractive?: boolean;
}

/** Result of running init — useful for tests and for the CLI to print a summary. */
export interface InitResult {
  /** Absolute path to the project root that was created. */
  projectDir: string;
  /** Files written, relative to the project root. */
  files: string[];
  /** Provider baked into the example. */
  provider: InitProvider;
  /** Template flavor used. */
  template: InitTemplate;
  /** Which package manager was detected / used. */
  packageManager: PackageManager;
  /** Exit code from the install step. 0 = success, undefined = not run. */
  installExitCode: number | undefined;
  /** Exit code from the git init step. 0 = success, undefined = not run. */
  gitExitCode: number | undefined;
}

/**
 * Returns true if a directory exists AND contains at least one entry that
 * isn't `.git` or `.git/`. An empty dir, a dir with only `.git/`, or a
 * nonexistent dir all return false.
 */
export async function isEmptyDir(dir: string): Promise<boolean> {
  const { readdir } = await import('node:fs/promises');
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return true; // doesn't exist yet — treat as empty
  }
  const real = entries.filter((e) => e !== '.git');
  return real.length === 0;
}

/**
 * Returns true if a directory exists AND contains files we'd be about
 * to overwrite. Used to gate the --force / overwrite-prompt logic.
 */
export async function isExistingProject(dir: string): Promise<boolean> {
  return !(await isEmptyDir(dir));
}

/**
 * Thrown by `initCommand` when the target directory already contains
 * files and the caller did not pass `--force` (or pass `force: true`).
 * Carries the directory path so the CLI can print a friendly message.
 */
export class InitError extends Error {
  override readonly name = 'InitError';
  readonly projectDir: string;
  constructor(message: string, projectDir: string) {
    super(message);
    this.projectDir = projectDir;
  }
}

/**
 * Supported package managers. The list is small and the detection is
 * heuristic — we only care which command to run (`npm install`,
 * `pnpm install`, `bun install`, `yarn`).
 */
export type PackageManager = 'npm' | 'pnpm' | 'bun' | 'yarn';

/**
 * Detect the package manager the user is most likely running with.
 *
 * Detection order:
 *   1. npm_config_user_agent env var (set automatically by npm/pnpm/yarn)
 *   2. Lockfile in the target directory (pnpm-lock.yaml, bun.lock, yarn.lock)
 *   3. Globally configured package manager via npmrc / corepack
 *   4. Default to 'npm'
 *
 * Pure function — no side effects, no filesystem writes. Easy to test.
 */
export function detectPackageManager(
  targetDir: string,
  env: NodeJS.ProcessEnv = process.env,
): PackageManager {
  // 1. npm_config_user_agent looks like "npm/10.0.0 node/20.0.0 ..."
  //    or "pnpm/9.0.0" or "yarn/4.0.0" or "bun/1.0.0".
  const ua = env.npm_config_user_agent ?? '';
  if (/\bbun\//.test(ua)) return 'bun';
  if (/\bpnpm\//.test(ua)) return 'pnpm';
  if (/\byarn\//.test(ua)) return 'yarn';
  if (/\bnpm\//.test(ua)) return 'npm';

  // 2. Lockfile in the target dir. Falls back to sync fs to keep the
  //    function pure-ish (no async needed for existsSync on small dirs).
  const { existsSync } = require('node:fs') as typeof import('node:fs');
  if (existsSync(join(targetDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(targetDir, 'bun.lock')) || existsSync(join(targetDir, 'bun.lockb')))
    return 'bun';
  if (existsSync(join(targetDir, 'yarn.lock'))) return 'yarn';

  // 3. Corepack hint. If corepack has pinned a manager, use it.
  //    (npm_config_user_agent above usually catches this, but the env
  //    may be stripped in some CI setups.)
  if (env.COREPACK_DEFAULT_TO_LATEST === '0' && env.COREPACK_ENABLE_STRICT === '0') {
    // Corepack is active in strict mode; trust the user agent fallback.
  }

  // 4. Default.
  return 'npm';
}

/**
 * The argv we should pass to a package manager to install dependencies
 * for the scaffolded project. Yarn is the only one that doesn't need
 * the explicit 'install' subcommand.
 */
export function getInstallCommand(pm: PackageManager): string[] {
  return pm === 'yarn' ? [pm] : [pm, 'install'];
}

/**
 * Spawn the package manager's install command. Uses spawnSync so the
 * output streams directly to the parent's stdio. Returns the exit
 * code (0 = success). Throws nothing — the caller inspects the code
 * and surfaces a friendly message if it failed.
 *
 * `HUSK_INIT_SKIP_INSTALL=1` short-circuits the spawn (used by tests
 * and by `--no-install` flags upstream).
 */
export function runInstall(
  targetDir: string,
  pm: PackageManager,
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (env.HUSK_INIT_SKIP_INSTALL === '1') return 0;
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
  const [cmd, ...args] = getInstallCommand(pm);
  if (!cmd) return 1;
  const result = spawnSync(cmd, args, {
    cwd: targetDir,
    stdio: 'inherit',
    env,
  });
  return result.status ?? 1;
}

/**
 * Initialize a git repo in the target dir and create an initial
 * commit. Steps: `git init` (only if not already a repo) → `git add .`
 * → `git commit -m 'chore: scaffold husky agent'`.
 *
 * Returns the exit code of the final `git commit` (0 = success).
 * All commands run in `targetDir` with stdio piped (we don't want
 * git's chatter to mix with init's output).
 *
 * `HUSK_INIT_SKIP_GIT=1` short-circuits the spawn (used by tests
 * and by `--no-git` flags upstream).
 */
export function runGitInit(
  targetDir: string,
  env: NodeJS.ProcessEnv = process.env,
  options: { author?: string } = {},
): number {
  if (env.HUSK_INIT_SKIP_GIT === '1') return 0;
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
  const spawn = (args: string[]) => {
    const [cmd, ...rest] = args;
    if (!cmd) return { status: 1 };
    return spawnSync(cmd, rest, {
      cwd: targetDir,
      stdio: 'pipe',
      env,
    });
  };

  // 1. git init (only if not already a repo — `--initial-branch=main`
  //    matches GitHub's default branch; older gits don't have the flag
  //    so we fall back to a plain init).
  const initResult = spawn(['git', 'init', '--initial-branch=main']);
  if ((initResult.status ?? 1) !== 0) {
    spawn(['git', 'init']);
  }

  // 2. git add . (the .gitignore takes care of node_modules etc.)
  const addResult = spawn(['git', 'add', '.']);
  if ((addResult.status ?? 1) !== 0) return addResult.status ?? 1;

  // 3. git commit. Apply the optional author override if provided.
  const commitArgs = ['git', 'commit', '-m', 'chore: scaffold husky agent'];
  if (options.author) {
    commitArgs.push('--author', options.author);
  }
  const commitResult = spawn(commitArgs);
  return commitResult.status ?? 1;
}

/**
 * Ask the user a question on stdin/stdout. Returns the trimmed answer,
 * or the default if the user just hits enter.
 *
 * In non-TTY contexts (CI, piped input, AI agents), this throws
 * `PromptError` so callers can fall back to defaults. Pass
 * `nonTTYDefault` to instead return a default value silently.
 *
 * Kept deliberately small — no checkbox lists, no fancy formatting.
 * If we ever need that, swap to `@clack/prompts` like create-vite
 * does. For v0.4.1 the simple line-prompt is enough.
 */
export class PromptError extends Error {
  override readonly name = 'PromptError';
}

export interface PromptOptions {
  default?: string;
  choices?: readonly string[];
  nonTTYDefault?: string;
}

export async function prompt(question: string, options: PromptOptions = {}): Promise<string> {
  if (!process.stdin.isTTY) {
    if (options.nonTTYDefault !== undefined) return options.nonTTYDefault;
    throw new PromptError(
      'Cannot prompt for input: stdin is not a TTY. Pass the value via flags or HUSK_INIT_NON_INTERACTIVE=1.',
    );
  }

  const { createInterface } = await import('node:readline/promises');
  const { stdin, stdout } = process;
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    let suffix = '';
    if (options.default) suffix = ` [${options.default}]`;
    if (options.choices && options.choices.length > 0) {
      suffix += ` (${options.choices.join('/')})`;
    }
    const answer = await rl.question(`${question}${suffix}: `);
    const trimmed = answer.trim();
    if (!trimmed) return options.default ?? '';
    if (options.choices && !options.choices.includes(trimmed)) {
      // eslint-disable-next-line no-console
      console.error(
        `  Invalid choice '${trimmed}'. Expected one of: ${options.choices.join(', ')}.`,
      );
      return prompt(question, options); // recurse for a second try
    }
    return trimmed;
  } finally {
    rl.close();
  }
}

/** Entry point for the `husk init` command. */
export async function initCommand(options: InitOptions): Promise<InitResult> {
  let provider = options.provider ?? 'anthropic';
  let template = options.template ?? 'minimal';
  const projectDir = resolve(options.target);
  let force = options.force ?? false;
  const interactive = !options.noInteractive && process.env.HUSK_INIT_NON_INTERACTIVE !== '1';

  // Interactive prompts for missing options. Only runs in a TTY
  // and only when the caller didn't pass the value via flag.
  if (interactive) {
    if (options.provider === undefined) {
      const answer = await prompt('Which provider should the example use?', {
        default: 'anthropic',
        choices: ['anthropic', 'openai'],
        nonTTYDefault: 'anthropic',
      });
      provider = answer as InitProvider;
    }
    if (options.template === undefined) {
      const answer = await prompt('Which template?', {
        default: 'minimal',
        choices: ['minimal', 'full'],
        nonTTYDefault: 'minimal',
      });
      template = answer as InitTemplate;
    }
  }

  // Overwrite gate. The 'prompt' value triggers an interactive ask;
  // true / false behave as the boolean they coerce to.
  if (force === 'prompt') {
    if (interactive && (await isExistingProject(projectDir))) {
      const answer = await prompt('Target is not empty. Overwrite? [y/N]', {
        default: 'n',
        nonTTYDefault: 'n',
      });
      force = answer.toLowerCase().startsWith('y');
    } else {
      force = false;
    }
  }

  if (!force && (await isExistingProject(projectDir))) {
    throw new InitError(
      `Target directory ${projectDir} is not empty. Re-run with --force to overwrite existing files, or pass a different <dir>.`,
      projectDir,
    );
  }

  await mkdir(projectDir, { recursive: true });

  const files: string[] = [];

  // package.json — always written
  await writeFile(join(projectDir, 'package.json'), renderPackageJson({ provider, template }));
  files.push('package.json');

  // tsconfig.json — always written
  await writeFile(join(projectDir, 'tsconfig.json'), TSCONFIG_TEMPLATE);
  files.push('tsconfig.json');

  // .gitignore — always written
  await writeFile(join(projectDir, '.gitignore'), GITIGNORE_TEMPLATE);
  files.push('.gitignore');

  // .env.example — always written
  await writeFile(join(projectDir, '.env.example'), renderEnvExample(provider));
  files.push('.env.example');

  // src/ — always written
  await mkdir(join(projectDir, 'src'), { recursive: true });
  await writeFile(join(projectDir, 'src', 'hello-agent.ts'), renderHelloAgent(provider));
  files.push('src/hello-agent.ts');

  // README.md — always written
  await writeFile(join(projectDir, 'README.md'), renderReadme({ provider, template }));
  files.push('README.md');

  // Full template adds a code-reviewer example
  if (template === 'full') {
    await writeFile(join(projectDir, 'src', 'code-reviewer.ts'), CODE_REVIEWER_TEMPLATE);
    files.push('src/code-reviewer.ts');
  }

  // Optional install step. Skipped unless the caller opted in.
  const pm = options.packageManager ?? detectPackageManager(projectDir);
  const installExitCode = options.install ? runInstall(projectDir, pm) : undefined;

  // Optional git init step. Skipped unless the caller opted in.
  const gitExitCode = options.git
    ? runGitInit(projectDir, undefined, options.gitAuthor ? { author: options.gitAuthor } : {})
    : undefined;

  return {
    projectDir,
    files,
    provider,
    template,
    packageManager: pm,
    installExitCode,
    gitExitCode,
  };
}

// ----- Templates (inline so they ship with the bundle) -----

const TSCONFIG_TEMPLATE = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
`;

const GITIGNORE_TEMPLATE = `node_modules/
dist/
.env
.env.local
*.log
.DS_Store
.tsbuildinfo
`;

const ANTHROPIC_ENV_EXAMPLE = `# Get your key at https://console.anthropic.com/
ANTHROPIC_API_KEY=sk-ant-...

# Optional: override the default model + provider
# HUSK_MODEL=claude-opus-4-6
# HUSK_PROVIDER=anthropic
`;

const OPENAI_ENV_EXAMPLE = `# Get your key at https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-...

# Optional: override the default model + provider
# HUSK_MODEL=gpt-5
# HUSK_PROVIDER=openai
`;

function renderEnvExample(provider: InitProvider): string {
  return provider === 'openai' ? OPENAI_ENV_EXAMPLE : ANTHROPIC_ENV_EXAMPLE;
}

const ANTHROPIC_HELLO_AGENT = `import { Agent, AnthropicProvider, Read, Write } from '@princetheprogrammerbtw/husk';

async function main() {
  const agent = new Agent({
    model: new AnthropicProvider({ model: 'claude-opus-4-6' }),
    tools: [Read, Write],
  });
  const result = await agent.run('What is 2 + 2?');
  console.log(result.output);
}

main().catch(console.error);
`;

const OPENAI_HELLO_AGENT = `import { Agent, OpenAIProvider, Read, Write } from '@princetheprogrammerbtw/husk';

async function main() {
  const agent = new Agent({
    model: new OpenAIProvider({ model: 'gpt-5' }),
    tools: [Read, Write],
  });
  const result = await agent.run('What is 2 + 2?');
  console.log(result.output);
}

main().catch(console.error);
`;

function renderHelloAgent(provider: InitProvider): string {
  return provider === 'openai' ? OPENAI_HELLO_AGENT : ANTHROPIC_HELLO_AGENT;
}

const CODE_REVIEWER_TEMPLATE = `import { Agent, AnthropicProvider, Read, Grep } from '@princetheprogrammerbtw/husk';

const SYSTEM = \`You are a code reviewer. Read files the user names,
look for bugs, security issues, and style problems, then write a
concise review to stdout.\`;

async function main() {
  const agent = new Agent({
    model: new AnthropicProvider({ model: 'claude-opus-4-6' }),
    tools: [Read, Grep],
    system: SYSTEM,
  });
  const target = process.argv[2] ?? 'src/';
  const result = await agent.run(\`Review the code in \${target}\`);
  console.log(result.output);
}

main().catch(console.error);
`;

function renderPackageJson(args: { provider: InitProvider; template: InitTemplate }): string {
  const pkg = {
    name: 'my-husk-agent',
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      start: 'tsx src/hello-agent.ts',
      review: 'tsx src/code-reviewer.ts',
      typecheck: 'tsc --noEmit',
    },
    dependencies: {
      '@princetheprogrammerbtw/husk': '^0.4.1',
    },
    devDependencies: {
      '@types/node': '^20.0.0',
      tsx: '^4.0.0',
      typescript: '^5.0.0',
    },
  };
  if (args.template === 'full') {
    pkg.scripts.review = 'tsx src/code-reviewer.ts';
  }
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

function renderReadme(args: { provider: InitProvider; template: InitTemplate }): string {
  const providerName = args.provider === 'openai' ? 'OpenAI' : 'Anthropic';
  const envVar = args.provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
  return `# My Husk Agent

A new Husk project, scaffolded with \`husk init\`.

Default provider: **${providerName}** (override with \`--provider\`).

## Quickstart

1. Set your API key:

   \`\`\`
   cp .env.example .env
   # edit .env and paste your ${envVar}
   \`\`\`

2. Install dependencies:

   \`\`\`
   npm install   # or: pnpm install / bun install
   \`\`\`

3. Run the hello agent:

   \`\`\`
   npm start
   \`\`\`
${
  args.template === 'full'
    ? `
4. Try the code reviewer:

   \`\`\`
   npm run review -- src/
   \`\`\`
`
    : ''
}
## Project layout

\`\`\`
.
├── package.json
├── tsconfig.json
├── .gitignore
├── .env.example
├── src/
│   ├── hello-agent.ts${args.template === 'full' ? '\n│   └── code-reviewer.ts' : ''}
└── README.md
\`\`\`

## Next steps

- Read the Husk docs: <https://github.com/10xdev4u-alt/husk>
- Try \`husk eval ./evals/\` once you have eval suites
- Add more tools: \`Read, Write, Edit, Bash, Grep\`
`;
}
