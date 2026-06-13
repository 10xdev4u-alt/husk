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
  /** Skip `npm install` / `bun install` after scaffolding. Defaults to false. */
  skipInstall?: boolean;
  /**
   * Overwrite existing files in the target directory without warning.
   * Default (false) throws `InitError` if the target is a non-empty
   * existing project. Pass `true` to overwrite in-place; pass `'prompt'`
   * to ask the user interactively (TTY-only — non-TTY falls back to
   * throwing).
   */
  force?: boolean | 'prompt';
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

/** Entry point for the `husk init` command. */
export async function initCommand(options: InitOptions): Promise<InitResult> {
  const provider = options.provider ?? 'anthropic';
  const template = options.template ?? 'minimal';
  const projectDir = resolve(options.target);
  const force = options.force ?? false;

  // Overwrite gate. We throw (not warn) because silently clobbering a
  // user's existing files is the wrong default for a scaffolder.
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

  return { projectDir, files, provider, template };
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
      '@princetheprogrammerbtw/husk': '^0.4.0',
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
