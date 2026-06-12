/**
 * Husk — built-in Edit tool.
 *
 * Performs a string replacement in a file. The 'oldText' must match
 * exactly (including whitespace) and must appear exactly once in the
 * file. This single-match requirement is what makes the operation
 * safe: ambiguous replacements fail loudly rather than corrupting
 * unrelated sections.
 *
 * For multi-occurrence replacements, the agent should read the file
 * first to identify the exact context, then call Edit with enough
 * surrounding lines to make the match unique.
 */

import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { defineTool, objectSchema, stringField } from '../registry.js';

export interface EditInput {
  /** Path to the file, relative to the working directory. */
  path: string;
  /** The exact text to replace. Must match exactly one location. */
  oldText: string;
  /** The text to replace it with. */
  newText: string;
}

export const Edit = defineTool<EditInput>({
  name: 'Edit',
  description:
    'Replace a specific string in a file. The oldText must match exactly one location in the file (include enough surrounding context to make it unique). Use this for small, targeted changes; use Write for full file rewrites.',
  inputSchema: objectSchema(
    {
      path: stringField('Path to the file, relative to the working directory.'),
      oldText: stringField('The exact text to replace. Must match exactly once in the file.'),
      newText: stringField('The text to replace it with.'),
    },
    ['path', 'oldText', 'newText'],
  ),
  execute: async (input) => {
    const absolute = resolve(input.path);

    let original: string;
    try {
      original = await fs.readFile(absolute, 'utf-8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error reading file '${input.path}': ${message}`;
    }

    // Count occurrences — require exactly one.
    let count = 0;
    let idx = -1;
    let searchFrom = 0;
    while (true) {
      const found = original.indexOf(input.oldText, searchFrom);
      if (found === -1) break;
      count += 1;
      idx = found;
      searchFrom = found + 1;
    }

    if (count === 0) {
      return `Error: oldText not found in file '${input.path}'. The text must match exactly (including whitespace and indentation).`;
    }
    if (count > 1) {
      return `Error: oldText matches ${count} locations in '${input.path}'. Include more surrounding context to make the match unique, or call Edit separately for each occurrence.`;
    }

    const updated =
      original.slice(0, idx) + input.newText + original.slice(idx + input.oldText.length);
    try {
      await fs.writeFile(absolute, updated, 'utf-8');
      return `Edited ${absolute} (replaced ${input.oldText.length} chars with ${input.newText.length} chars)`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error writing file '${input.path}': ${message}`;
    }
  },
});
