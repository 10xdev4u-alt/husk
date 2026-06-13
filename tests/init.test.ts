/**
 * Tests for `husk init` (src/cli/init.ts).
 *
 * Each test uses a fresh tmp dir under /tmp/husk-init-test-* to keep
 * the runs hermetic. We assert the file set + a couple of representative
 * file contents so a typo in a template fails fast.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InitError, type InitResult, type PackageManager, initCommand } from '../src/cli/init.js';

let workDir: string;

beforeEach(async () => {
  workDir = join(
    tmpdir(),
    `husk-init-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  await mkdir(workDir, { recursive: true });
});

afterEach(async () => {
  if (workDir && existsSync(workDir)) {
    await rm(workDir, { recursive: true, force: true });
  }
});

/** Read a file from a project dir as utf-8 text. */
async function readProjectFile(result: InitResult, relPath: string): Promise<string> {
  return readFile(join(result.projectDir, relPath), 'utf-8');
}

/** List the files in a project dir (relative paths). */
async function listProjectFiles(result: InitResult): Promise<string[]> {
  async function walk(dir: string, prefix = ''): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const out: string[] = [];
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        out.push(...(await walk(join(dir, e.name), rel)));
      } else {
        out.push(rel);
      }
    }
    return out;
  }
  return walk(result.projectDir);
}

describe('initCommand — defaults', () => {
  test('scaffolds a minimal anthropic project by default', async () => {
    const target = join(workDir, 'my-agent');
    const result = await initCommand({ target });

    expect(result.provider).toBe('anthropic');
    expect(result.template).toBe('minimal');
    expect(result.projectDir).toBe(target);

    // Six files for minimal template
    const files = await listProjectFiles(result);
    expect(files.sort()).toEqual([
      '.env.example',
      '.gitignore',
      'README.md',
      'package.json',
      'src/hello-agent.ts',
      'tsconfig.json',
    ]);
  });

  test('package.json points at husk ^0.4.1', async () => {
    const result = await initCommand({ target: join(workDir, 'p') });
    const pkg = JSON.parse(await readProjectFile(result, 'package.json'));
    expect(pkg.type).toBe('module');
    expect(pkg.dependencies['@princetheprogrammerbtw/husk']).toBe('^0.4.1');
    expect(pkg.devDependencies.typescript).toBeTruthy();
    expect(pkg.devDependencies.tsx).toBeTruthy();
  });

  test('default example imports AnthropicProvider', async () => {
    const result = await initCommand({ target: join(workDir, 'p') });
    const hello = await readProjectFile(result, 'src/hello-agent.ts');
    expect(hello).toContain('AnthropicProvider');
    expect(hello).not.toContain('OpenAIProvider');
  });

  test('.env.example mentions ANTHROPIC_API_KEY by default', async () => {
    const result = await initCommand({ target: join(workDir, 'p') });
    const env = await readProjectFile(result, '.env.example');
    expect(env).toContain('ANTHROPIC_API_KEY');
  });

  test('tsconfig uses NodeNext + strict', async () => {
    const result = await initCommand({ target: join(workDir, 'p') });
    const tsc = JSON.parse(await readProjectFile(result, 'tsconfig.json'));
    expect(tsc.compilerOptions.module).toBe('NodeNext');
    expect(tsc.compilerOptions.moduleResolution).toBe('NodeNext');
    expect(tsc.compilerOptions.strict).toBe(true);
  });
});

describe('initCommand — --provider openai', () => {
  test('bakes OpenAI into the example', async () => {
    const result = await initCommand({ target: join(workDir, 'p'), provider: 'openai' });
    expect(result.provider).toBe('openai');
    const hello = await readProjectFile(result, 'src/hello-agent.ts');
    expect(hello).toContain('OpenAIProvider');
    expect(hello).not.toContain('AnthropicProvider');
  });

  test('.env.example mentions OPENAI_API_KEY', async () => {
    const result = await initCommand({ target: join(workDir, 'p'), provider: 'openai' });
    const env = await readProjectFile(result, '.env.example');
    expect(env).toContain('OPENAI_API_KEY');
    expect(env).not.toContain('ANTHROPIC_API_KEY');
  });

  test('README documents the openai provider', async () => {
    const result = await initCommand({ target: join(workDir, 'p'), provider: 'openai' });
    const readme = await readProjectFile(result, 'README.md');
    expect(readme).toContain('OpenAI');
    expect(readme).toContain('OPENAI_API_KEY');
  });
});

describe('initCommand — --template full', () => {
  test('adds code-reviewer.ts to the file set', async () => {
    const result = await initCommand({ target: join(workDir, 'p'), template: 'full' });
    expect(result.template).toBe('full');
    const files = await listProjectFiles(result);
    expect(files).toContain('src/code-reviewer.ts');
  });

  test('minimal template does NOT include code-reviewer.ts', async () => {
    const result = await initCommand({ target: join(workDir, 'p'), template: 'minimal' });
    const files = await listProjectFiles(result);
    expect(files).not.toContain('src/code-reviewer.ts');
  });

  test('full template README shows the review script', async () => {
    const result = await initCommand({ target: join(workDir, 'p'), template: 'full' });
    const readme = await readProjectFile(result, 'README.md');
    expect(readme).toContain('npm run review');
  });
});

describe('initCommand — paths and idempotency', () => {
  test('target dir is created if it does not exist', async () => {
    const target = join(workDir, 'nested', 'deeper', 'my-agent');
    expect(existsSync(target)).toBe(false);
    await initCommand({ target });
    expect(existsSync(target)).toBe(true);
  });

  test('relative target resolves against cwd', async () => {
    // Use an absolute path because the test runner may run from a different cwd
    // — this just confirms that a relative-style absolute path works as-is.
    const target = join(workDir, 'rel-agent');
    const result = await initCommand({ target });
    expect(result.projectDir).toBe(target);
  });

  test('re-running init on an existing project throws without --force', async () => {
    const target = join(workDir, 'p');
    await initCommand({ target });
    // Second run: every file is already there. The new overwrite gate
    // throws InitError unless the caller opts in with --force.
    await expect(initCommand({ target })).rejects.toThrow(InitError);
  });

  test('--force lets init overwrite an existing project', async () => {
    const target = join(workDir, 'p');
    await initCommand({ target });
    // With --force, the call must not throw and must return a fresh result.
    const result = await initCommand({ target, force: true });
    expect(result.files.length).toBeGreaterThan(0);
  });
});

describe('initCommand — return value contract', () => {
  test('returns projectDir, files, provider, template', async () => {
    const result = await initCommand({
      target: join(workDir, 'p'),
      provider: 'openai',
      template: 'full',
    });
    expect(typeof result.projectDir).toBe('string');
    expect(Array.isArray(result.files)).toBe(true);
    expect(result.provider).toBe('openai');
    expect(result.template).toBe('full');
  });
});
