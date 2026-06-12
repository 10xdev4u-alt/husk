/**
 * Husk — built-in Grep tool.
 *
 * Searches files for a regex pattern. Uses ripgrep ('rg') if available
 * for speed; falls back to grep with --line-numbers --no-heading.
 * Returns matching lines with file:line:content format.
 *
 * Default scope: the current working directory, recursively, respecting
 * .gitignore. The model can scope to a specific path or file.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { booleanField, defineTool, integerField, objectSchema, stringField } from '../registry.js';

const execAsync = promisify(exec);

export interface GrepInput {
  /** Regex pattern to search for. */
  pattern: string;
  /** File or directory to search in. Default: current directory. */
  path?: string;
  /** File glob to filter by (e.g. '*.ts'). Default: all files. */
  glob?: string;
  /** Case-insensitive search. Default: false. */
  ignoreCase?: boolean;
  /** Maximum number of matching lines to return. Default: 100. */
  limit?: number;
}

export const Grep = defineTool<GrepInput>({
  name: 'Grep',
  description: `Search files for a regex pattern. Returns matching lines in 'file:line:content' format. Uses ripgrep if available, falls back to grep. Default scope is the current directory, recursive, respecting .gitignore.`,
  inputSchema: objectSchema(
    {
      pattern: stringField('Regex pattern to search for.'),
      path: stringField('File or directory to search in. Default: current directory.'),
      glob: stringField("File glob to filter by (e.g. '*.ts'). Default: all files."),
      ignoreCase: booleanField('Case-insensitive search. Default: false.'),
      limit: integerField('Maximum number of matching lines to return. Default: 100.'),
    },
    ['pattern'],
  ),
  execute: async (input) => {
    const limit = input.limit ?? 100;
    const target = input.path ?? '.';
    // Try ripgrep first (much faster, respects .gitignore by default).
    try {
      const args = [
        '--line-number',
        '--no-heading',
        '--color=never',
        ...(input.ignoreCase ? ['--ignore-case'] : []),
        ...(input.glob ? [`--glob=${input.glob}`] : []),
        '--',
        input.pattern,
        target,
      ];
      const { stdout } = await execAsync(`rg ${args.map(shellQuote).join(' ')}`, {
        maxBuffer: 10 * 1024 * 1024,
      });
      return truncateOutput(stdout, limit);
    } catch (err) {
      // rg exits with code 1 when no matches found; treat as empty result
      // if we got empty stdout. For other errors, fall back to grep.
      const e = err as { code?: number; stdout?: string };
      if (e.code === 1 && !e.stdout) {
        return 'No matches found.';
      }
    }

    // Fallback: plain grep.
    try {
      const args = [
        '-rn',
        '--color=never',
        ...(input.ignoreCase ? ['-i'] : []),
        ...(input.glob ? [`--include=${input.glob}`] : []),
        '-E',
        '--',
        input.pattern,
        target,
      ];
      const { stdout } = await execAsync(`grep ${args.map(shellQuote).join(' ')}`, {
        maxBuffer: 10 * 1024 * 1024,
      });
      return truncateOutput(stdout, limit);
    } catch (err) {
      const e = err as { code?: number; stdout?: string; message?: string };
      if (e.code === 1 && !e.stdout) {
        return 'No matches found.';
      }
      return `Error running grep: ${e.message ?? 'unknown'}`;
    }
  },
});

function shellQuote(s: string): string {
  // Conservative shell-safe quoting for tool arguments.
  if (/^[a-zA-Z0-9_./:=@%+-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function truncateOutput(output: string, limit: number): string {
  const lines = output.split('\n');
  if (lines.length <= limit) return output || 'No matches found.';
  return `${lines.slice(0, limit).join('\n')}\n... (${lines.length - limit} more matches truncated)`;
}
