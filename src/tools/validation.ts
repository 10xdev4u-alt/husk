/**
 * Husk — tool validation framework.
 *
 * Tools can declare optional validation rules that run before the
 * tool's execute() is called. Rules return null on pass or an
 * error message string on failure. If any rule fails, the tool is
 * not executed and the error is returned to the model (with
 * isError: true) so it can self-correct.
 *
 * Why this exists: schema validation catches "shape" bugs (missing
 * fields, wrong types), but not safety or policy bugs. The model
 * might call Bash with `rm -rf /` or Write with a path outside the
 * project. Validation rules are the place for those checks.
 *
 * v0.5.0 ships the framework + four common validators:
 *   - pathAllowed(baseDir)  — keeps file paths within a base dir
 *   - commandDenylist(cmds) — blocks dangerous shell commands
 *   - maxFileSize(bytes)    — caps file write sizes
 *   - shellMetacharacters() — flags unescaped shell metachars
 *
 * Custom validators are just objects with a name and a check fn.
 * No DSL, no magic. The agent loop is the orchestrator; you supply
 * the policy.
 */

import { basename, isAbsolute, relative, resolve } from 'node:path';

// ───────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────

/** Context passed to every validation rule. */
export interface ValidationContext {
  /** Name of the tool being validated (handy for error messages). */
  readonly toolName: string;
  /** Absolute path of the agent's working directory. */
  readonly cwd: string;
  /** The tool's input object. Pre-validated against inputSchema. */
  readonly input: unknown;
  /** Process env, in case the validator needs to look at it. */
  readonly env: NodeJS.ProcessEnv;
}

/**
 * A validation rule. `check` returns `null` if the input passes,
 * or an error message string if it fails. Multiple rules can be
 * applied to one tool — they all run, and the first failure short-
 * circuits with that error message.
 */
export interface ValidationRule {
  /** Short identifier for the rule (e.g. 'path-allowed', 'no-rm-rf'). */
  readonly name: string;
  /**
   * Returns null if input passes, or an error message string if it
   * fails. The message should be specific enough for the model to
   * understand and self-correct ("Path /etc/passwd is outside the
   * allowed base directory /home/user/project", not "bad path").
   */
  readonly check: (input: unknown, ctx: ValidationContext) => string | null;
}

/** Either a single rule or an array of rules. */
export type ValidationRuleSet = ValidationRule | readonly ValidationRule[];

/** Helper to normalize a rule set to an array. */
export function normalizeRules(set: ValidationRuleSet): readonly ValidationRule[] {
  if (Array.isArray(set)) return set;
  return [set as ValidationRule];
}

/** Helper to define a validation rule with a name + check fn. */
export function defineValidation(
  name: string,
  check: (input: unknown, ctx: ValidationContext) => string | null,
): ValidationRule {
  return { name, check };
}

/** Helper to bundle several rules into one rule set. */
export function defineValidationSet(
  ...rules: readonly ValidationRule[]
): readonly ValidationRule[] {
  return rules;
}

// ───────────────────────────────────────────────────────────────────
// Common validators
// ───────────────────────────────────────────────────────────────────

/**
 * Reject file paths that escape the allowed base directory.
 * Use for Write / Edit / Read tools to keep the model from poking
 * at /etc, ~/.ssh, etc.
 *
 * Looks at the `path` field of the input by default; pass a
 * different `field` for tools that use a different key.
 *
 * Symlinks are NOT resolved — the check is lexical. If the user
 * symlinks their way out, that's on them. For a real sandbox,
 * combine with `fs.realpath` at execute time.
 */
export function pathAllowed(options: {
  /** Base directory paths must stay within. */
  baseDir: string;
  /** Field name to check. Default: 'path'. */
  field?: string;
  /** Allow absolute paths outside baseDir if they pass through unchanged? Default: false. */
  allowAbsolute?: boolean;
}): ValidationRule {
  const field = options.field ?? 'path';
  const baseAbs = resolve(options.baseDir);
  return defineValidation(`path-allowed(${basename(baseAbs)})`, (input, ctx) => {
    const obj = input as Record<string, unknown> | null;
    if (!obj || typeof obj !== 'object') return null; // not our concern
    const value = obj[field];
    if (typeof value !== 'string') return null; // schema validator handles this
    if (
      !isAbsolute(value) &&
      !value.startsWith('~/') &&
      !value.startsWith('./') &&
      !value.startsWith('../')
    ) {
      return null; // bare relative — let the tool resolve it
    }
    const abs = resolve(ctx.cwd, value.replace(/^~/, process.env.HOME ?? ctx.cwd));
    const rel = relative(baseAbs, abs);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      if (!options.allowAbsolute && isAbsolute(value)) {
        return `Path '${value}' is outside the allowed base directory '${baseAbs}'`;
      }
      if (rel.startsWith('..')) {
        return `Path '${value}' resolves to '${abs}', which is outside the allowed base directory '${baseAbs}'`;
      }
    }
    return null;
  });
}

/**
 * Reject shell commands that match any in the denylist. The match
 * is on the first token (the program name) — so `rm -rf /` is
 * blocked but `grep` running with a file named `rm` is not.
 *
 * Use for Bash tools to keep the model from nuking the filesystem.
 */
export function commandDenylist(denied: readonly string[]): ValidationRule {
  const deniedSet = new Set(denied.map((d) => d.toLowerCase()));
  return defineValidation('command-denylist', (input) => {
    const obj = input as Record<string, unknown> | null;
    if (!obj || typeof obj !== 'object') return null;
    const cmd = obj.command;
    if (typeof cmd !== 'string') return null;
    const firstToken = cmd.trim().split(/\s+/)[0]?.toLowerCase();
    if (!firstToken) return null;
    if (deniedSet.has(firstToken)) {
      return `Command '${firstToken}' is on the denylist. Choose a safer alternative.`;
    }
    return null;
  });
}

/**
 * Cap the size of a string field. Useful for Write tools to prevent
 * the model from accidentally (or intentionally) writing gigabytes.
 */
export function maxFieldSize(options: {
  /** Field name to check. */
  field: string;
  /** Maximum allowed size in bytes. */
  maxBytes: number;
}): ValidationRule {
  return defineValidation(`max-field-size(${options.field})`, (input) => {
    const obj = input as Record<string, unknown> | null;
    if (!obj || typeof obj !== 'object') return null;
    const value = obj[options.field];
    if (typeof value !== 'string') return null;
    const bytes = Buffer.byteLength(value, 'utf-8');
    if (bytes > options.maxBytes) {
      return `Field '${options.field}' is ${bytes} bytes, exceeds max of ${options.maxBytes}`;
    }
    return null;
  });
}

/**
 * Flag unescaped shell metacharacters in a string field. Use for
 * Bash command fields to surface risky shell expansion before the
 * tool runs. We allow the common safe cases (quotes, dashes, dots,
 * slashes) and flag the dangerous ones (backticks, $(), &, |, ;).
 */
export function noShellMetacharacters(options: { field: string }): ValidationRule {
  return defineValidation(`no-shell-metachars(${options.field})`, (input) => {
    const obj = input as Record<string, unknown> | null;
    if (!obj || typeof obj !== 'object') return null;
    const value = obj[options.field];
    if (typeof value !== 'string') return null;
    if (/[`$]|&&|\|\||;|\$\(/.test(value)) {
      return `Field '${options.field}' contains shell metacharacters that could lead to command injection. Escape them or use a safer API.`;
    }
    return null;
  });
}
