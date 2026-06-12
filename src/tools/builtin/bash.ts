/**
 * Husk — built-in Bash tool.
 *
 * Executes a shell command and returns stdout/stderr/exit code. The
 * harness is the model running with developer-level filesystem
 * access, so a "rm -rf /" mistake is catastrophic. The safety rails
 * here are a first line of defense — they catch the obvious
 * footguns, not all of them.
 *
 * Safety rails (v0.1.0):
 * - Block a denylist of catastrophic command patterns. The denylist
 *   is regex-based, scoped to the command string, and intentionally
 *   conservative. False positives (a command that looks dangerous
 *   but isn't) are acceptable; false negatives are not.
 * - Time out after 60 seconds by default. The model can request a
 *   longer timeout (max 10 minutes).
 *
 * Not in scope for v0.1.0 (deferred to v0.2 with config flag):
 * - Per-command confirmation prompts
 * - Network egress filtering
 * - Filesystem sandboxing
 * - Audit logging to a separate file
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { defineTool, integerField, objectSchema, stringField } from '../registry.js';

const execAsync = promisify(exec);

// Patterns that are almost always catastrophic. Conservative — we'd
// rather block a legit command than let a destructive one through.
const DENY_PATTERNS: readonly RegExp[] = [
  /\brm\s+(-[a-z]*f[a-z]*\s+)?-[a-z]*r[a-z]*\s+\/\s*$/i, // rm -rf / (with optional -f variations)
  /\brm\s+(-[a-z]*r[a-z]*\s+)?-[a-z]*f[a-z]*\s+\/\s*$/i, // rm -rf / (reversed flags)
  /\bdd\s+.*\bof=\/dev\/(sd|hd|nvme|vd)/i, // dd to a raw block device
  /\bmkfs(\.[a-z0-9]+)?\s+\/dev\/(sd|hd|nvme|vd)/i, // mkfs on a raw block device
  /:\(\)\s*\{.*:\s*\|.*&\s*\}\s*;\s*:/, // classic bash fork bomb
  />\s*\/dev\/(sd|hd|nvme|vd)/i, // redirect to a raw block device
  /\bchmod\s+(-R\s+)?000\s+\//i, // chmod 000 /
  /\bchown\s+(-R\s+)?\S+\s+\/\s*$/i, // chown -R anything /
];

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 600_000; // 10 minutes

export interface BashInput {
  /** The shell command to execute. */
  command: string;
  /** Optional description of what the command does (for logging). */
  description?: string;
  /** Timeout in milliseconds. Default: 60000 (1 min). Max: 600000 (10 min). */
  timeout?: number;
}

export const Bash = defineTool<BashInput>({
  name: 'Bash',
  description:
    'Execute a shell command. Returns stdout, stderr (if any), and the exit code. Use for running scripts, installing packages, git operations, and other shell tasks. Has a 60-second default timeout; pass timeout (in ms) for longer commands.',
  inputSchema: objectSchema(
    {
      command: stringField('The shell command to execute.'),
      description: stringField('A short description of what this command does (for logging).'),
      timeout: integerField('Timeout in milliseconds. Default: 60000. Max: 600000.'),
    },
    ['command'],
  ),
  execute: async (input) => {
    // ── Safety: denylist check ─────────────────────────────────
    for (const pattern of DENY_PATTERNS) {
      if (pattern.test(input.command)) {
        return `Error: command blocked by safety policy. The command matches a known dangerous pattern: ${pattern}\n\nIf this is intentional, the user must run it manually.`;
      }
    }

    const timeout = Math.min(input.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

    try {
      const { stdout, stderr } = await execAsync(input.command, { timeout });
      const out = stdout ? `STDOUT:\n${stdout}` : '(no stdout)';
      const err = stderr ? `\nSTDERR:\n${stderr}` : '';
      return `${out}${err}`.trim();
    } catch (err) {
      const e = err as {
        stdout?: string;
        stderr?: string;
        code?: number;
        message?: string;
        killed?: boolean;
      };
      if (e.killed) {
        return `Error: command timed out after ${timeout}ms. If you need longer, pass a higher timeout (max 600000ms).`;
      }
      const out = e.stdout ? `STDOUT:\n${e.stdout}\n` : '';
      const errOut = e.stderr ? `STDERR:\n${e.stderr}\n` : '';
      return `Error: command exited with code ${e.code ?? 'unknown'}.\n${out}${errOut}Message: ${e.message ?? 'unknown'}`;
    }
  },
});
