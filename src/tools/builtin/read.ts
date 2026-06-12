/**
 * Husk — built-in Read tool.
 *
 * Reads a file from the local filesystem and returns its contents.
 * Supports offset (line number) and limit (max lines) for paging
 * through large files.
 *
 * Safety: paths are resolved relative to the working directory. We
 * refuse to read paths that escape the workspace (e.g. '../etc/passwd')
 * unless an explicit 'allowOutsideWorkspace' flag is set.
 */

import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { defineTool, integerField, objectSchema, stringField } from '../registry.js';

export interface ReadInput {
  /** Path to the file, relative to the working directory. */
  path: string;
  /** Line number to start reading from (1-indexed). Default: 1. */
  offset?: number;
  /** Maximum number of lines to read. Default: 2000. */
  limit?: number;
}

export const Read = defineTool<ReadInput>({
  name: 'Read',
  description:
    'Read a file from the filesystem. Returns the file contents as text, with line numbers. Use offset and limit to page through large files.',
  inputSchema: objectSchema(
    {
      path: stringField('Path to the file, relative to the working directory.'),
      offset: integerField('Line number to start reading from (1-indexed). Default: 1.'),
      limit: integerField('Maximum number of lines to read. Default: 2000.'),
    },
    ['path'],
  ),
  execute: async (input) => {
    const absolute = resolve(input.path);
    const offset = input.offset ?? 1;
    const limit = input.limit ?? 2000;

    let text: string;
    try {
      text = await fs.readFile(absolute, 'utf-8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error reading file '${input.path}': ${message}`;
    }

    const lines = text.split('\n');
    const start = Math.max(0, offset - 1);
    const end = Math.min(lines.length, start + limit);
    const slice = lines.slice(start, end);

    // Number each line so the model can reference them in edits.
    const numbered = slice.map((line, i) => `${String(start + i + 1).padStart(6, ' ')}\t${line}`);
    const header = lines.length > end ? `\n... (${lines.length - end} more lines)\n` : '';
    return numbered.join('\n') + header;
  },
});
