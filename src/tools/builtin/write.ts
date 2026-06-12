/**
 * Husk — built-in Write tool.
 *
 * Writes a file to the local filesystem. Creates parent directories
 * if they don't exist. Overwrites the file if it already exists.
 *
 * Returns the number of bytes written and the absolute path so the
 * model can confirm where the content landed.
 */

import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineTool, objectSchema, stringField } from '../registry.js';

export interface WriteInput {
  /** Path to the file, relative to the working directory. */
  path: string;
  /** Content to write. */
  content: string;
}

export const Write = defineTool<WriteInput>({
  name: 'Write',
  description:
    'Write content to a file. Creates parent directories as needed. Overwrites the file if it already exists. Use this for new files or full rewrites; use Edit for small changes.',
  inputSchema: objectSchema(
    {
      path: stringField('Path to the file, relative to the working directory.'),
      content: stringField('Content to write to the file.'),
    },
    ['path', 'content'],
  ),
  execute: async (input) => {
    const absolute = resolve(input.path);
    try {
      await fs.mkdir(dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, input.content, 'utf-8');
      const bytes = Buffer.byteLength(input.content, 'utf-8');
      return `Wrote ${bytes} bytes to ${absolute}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error writing file '${input.path}': ${message}`;
    }
  },
});
