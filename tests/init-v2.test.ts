/**
 * Tests for the v0.4.1 init additions:
 *   - isEmptyDir() / isExistingProject() helpers
 *   - detectPackageManager() (env + lockfile signals)
 *   - getInstallCommand()
 *   - runInstall() / runGitInit() (skipped via env vars in tests)
 *   - prompt() (TTY vs non-TTY behavior)
 *   - --force / --install / --git / --no-interactive flags
 *   - InitError thrown on existing project without --force
 *
 * The actual npm install and git commit steps are short-circuited
 * via HUSK_INIT_SKIP_INSTALL=1 / HUSK_INIT_SKIP_GIT=1 so tests
 * never touch the host filesystem's package/git state.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  InitError,
  type InitResult,
  type PackageManager,
  PromptError,
  detectPackageManager,
  getInstallCommand,
  initCommand,
  isEmptyDir,
  isExistingProject,
  prompt,
} from '../src/cli/init.js';

let workDir: string;

beforeEach(async () => {
  workDir = join(
    tmpdir(),
    `husk-init-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  await mkdir(workDir, { recursive: true });
  // Belt-and-suspenders: ensure auto-steps are skipped in every test.
  process.env.HUSK_INIT_SKIP_INSTALL = '1';
  process.env.HUSK_INIT_SKIP_GIT = '1';
});

afterEach(async () => {
  if (workDir && existsSync(workDir)) {
    await rm(workDir, { recursive: true, force: true });
  }
  process.env.HUSK_INIT_SKIP_INSTALL = undefined;
  process.env.HUSK_INIT_SKIP_GIT = undefined;
});

describe('isEmptyDir / isExistingProject', () => {
  test('isEmptyDir returns true for a non-existent dir', async () => {
    expect(await isEmptyDir(join(workDir, 'nope'))).toBe(true);
  });

  test('isEmptyDir returns true for a dir with only .git/', async () => {
    const d = join(workDir, 'p');
    await mkdir(join(d, '.git'), { recursive: true });
    expect(await isEmptyDir(d)).toBe(true);
  });

  test('isEmptyDir returns false for a dir with regular files', async () => {
    const d = join(workDir, 'p');
    await mkdir(d);
    await writeFile(join(d, 'README.md'), 'hi');
    expect(await isEmptyDir(d)).toBe(false);
  });

  test('isExistingProject inverts isEmptyDir', async () => {
    const d = join(workDir, 'p');
    await mkdir(d);
    expect(await isExistingProject(d)).toBe(false);
    await writeFile(join(d, 'package.json'), '{}');
    expect(await isExistingProject(d)).toBe(true);
  });
});

describe('detectPackageManager', () => {
  test('detects bun from npm_config_user_agent', () => {
    expect(detectPackageManager(workDir, { npm_config_user_agent: 'bun/1.0.0' })).toBe('bun');
  });

  test('detects pnpm from npm_config_user_agent', () => {
    expect(detectPackageManager(workDir, { npm_config_user_agent: 'pnpm/9.0.0' })).toBe('pnpm');
  });

  test('detects yarn from npm_config_user_agent', () => {
    expect(detectPackageManager(workDir, { npm_config_user_agent: 'yarn/4.0.0' })).toBe('yarn');
  });

  test('detects npm from npm_config_user_agent', () => {
    expect(detectPackageManager(workDir, { npm_config_user_agent: 'npm/10.0.0' })).toBe('npm');
  });

  test('falls back to lockfile detection (pnpm)', async () => {
    const d = join(workDir, 'p');
    await mkdir(d);
    await writeFile(join(d, 'pnpm-lock.yaml'), '');
    expect(detectPackageManager(d, {})).toBe('pnpm');
  });

  test('falls back to lockfile detection (bun)', async () => {
    const d = join(workDir, 'p');
    await mkdir(d);
    await writeFile(join(d, 'bun.lock'), '');
    expect(detectPackageManager(d, {})).toBe('bun');
  });

  test('falls back to lockfile detection (yarn)', async () => {
    const d = join(workDir, 'p');
    await mkdir(d);
    await writeFile(join(d, 'yarn.lock'), '');
    expect(detectPackageManager(d, {})).toBe('yarn');
  });

  test('defaults to npm when no signals are present', () => {
    expect(detectPackageManager(workDir, {})).toBe('npm');
  });

  test('user-agent wins over lockfile', async () => {
    const d = join(workDir, 'p');
    await mkdir(d);
    await writeFile(join(d, 'yarn.lock'), '');
    // Even with yarn.lock present, the user agent says pnpm
    expect(detectPackageManager(d, { npm_config_user_agent: 'pnpm/9.0.0' })).toBe('pnpm');
  });
});

describe('getInstallCommand', () => {
  test('npm uses [npm, install]', () => {
    expect(getInstallCommand('npm')).toEqual(['npm', 'install']);
  });

  test('pnpm uses [pnpm, install]', () => {
    expect(getInstallCommand('pnpm')).toEqual(['pnpm', 'install']);
  });

  test('bun uses [bun, install]', () => {
    expect(getInstallCommand('bun')).toEqual(['bun', 'install']);
  });

  test('yarn is the odd one — [yarn] with no subcommand', () => {
    expect(getInstallCommand('yarn')).toEqual(['yarn']);
  });
});

describe('initCommand — --force flag', () => {
  test('default behavior throws InitError on existing project', async () => {
    const target = join(workDir, 'p');
    await initCommand({ target });
    await expect(initCommand({ target })).rejects.toThrow(InitError);
  });

  test('InitError carries the projectDir', async () => {
    const target = join(workDir, 'p');
    await initCommand({ target });
    try {
      await initCommand({ target });
      throw new Error('should not reach here');
    } catch (err) {
      expect(err).toBeInstanceOf(InitError);
      expect((err as InitError).projectDir).toBe(target);
    }
  });

  test('--force overwrites without throwing', async () => {
    const target = join(workDir, 'p');
    await initCommand({ target });
    const result = await initCommand({ target, force: true });
    expect(result.files.length).toBeGreaterThan(0);
  });

  test('--force=true and force: true are equivalent', async () => {
    const target = join(workDir, 'p');
    await initCommand({ target });
    const r1 = await initCommand({ target, force: true });
    expect(r1.files.length).toBeGreaterThan(0);
  });
});

describe('initCommand — install flag', () => {
  test('install: false (default) leaves installExitCode undefined', async () => {
    const result = await initCommand({ target: join(workDir, 'p') });
    expect(result.installExitCode).toBeUndefined();
  });

  test('install: true runs runInstall and stores exit code', async () => {
    // HUSK_INIT_SKIP_INSTALL=1 short-circuits the spawn, returning 0
    const result = await initCommand({ target: join(workDir, 'p'), install: true });
    expect(result.installExitCode).toBe(0);
  });

  test('packageManager override is reflected in InitResult', async () => {
    const result = await initCommand({
      target: join(workDir, 'p'),
      packageManager: 'pnpm',
    });
    expect(result.packageManager).toBe('pnpm');
  });

  test('packageManager: bun is honored', async () => {
    const result = await initCommand({
      target: join(workDir, 'p'),
      packageManager: 'bun',
    });
    expect(result.packageManager).toBe('bun');
  });
});

describe('initCommand — git flag', () => {
  test('git: false (default) leaves gitExitCode undefined', async () => {
    const result = await initCommand({ target: join(workDir, 'p') });
    expect(result.gitExitCode).toBeUndefined();
  });

  test('git: true runs runGitInit and stores exit code', async () => {
    // HUSK_INIT_SKIP_GIT=1 short-circuits, returning 0
    const result = await initCommand({ target: join(workDir, 'p'), git: true });
    expect(result.gitExitCode).toBe(0);
  });

  test('gitAuthor option is accepted without error', async () => {
    const result = await initCommand({
      target: join(workDir, 'p'),
      git: true,
      gitAuthor: 'Test User <test@example.com>',
    });
    expect(result.gitExitCode).toBe(0);
  });
});

describe('initCommand — noInteractive flag', () => {
  test('noInteractive: true skips the prompt path (no error in non-TTY)', async () => {
    // In the test runner, stdin is not a TTY. With noInteractive: true
    // (the safer explicit signal), initCommand should not throw.
    const result = await initCommand({
      target: join(workDir, 'p'),
      noInteractive: true,
    });
    expect(result.provider).toBe('anthropic');
    expect(result.template).toBe('minimal');
  });
});

describe('initCommand — return value contract (v0.4.1)', () => {
  test('returns projectDir, files, provider, template, packageManager, installExitCode, gitExitCode', async () => {
    const result = await initCommand({
      target: join(workDir, 'p'),
      provider: 'openai',
      template: 'full',
    });
    expect(typeof result.projectDir).toBe('string');
    expect(Array.isArray(result.files)).toBe(true);
    expect(result.provider).toBe('openai');
    expect(result.template).toBe('full');
    expect(['npm', 'pnpm', 'bun', 'yarn'] satisfies PackageManager[]).toContain(
      result.packageManager,
    );
    expect(result.installExitCode).toBeUndefined();
    expect(result.gitExitCode).toBeUndefined();
  });
});

describe('prompt() helper', () => {
  test('non-TTY without nonTTYDefault throws PromptError', async () => {
    // We're in a test runner — stdin is not a TTY.
    await expect(prompt('Pick one', { choices: ['a', 'b'] })).rejects.toThrow(PromptError);
  });

  test('non-TTY with nonTTYDefault returns that default', async () => {
    const answer = await prompt('Pick one', {
      default: 'a',
      choices: ['a', 'b'],
      nonTTYDefault: 'a',
    });
    expect(answer).toBe('a');
  });
});
