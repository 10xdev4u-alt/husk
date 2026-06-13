import { defineConfig } from 'tsup';

/**
 * tsup build configuration for Husk.
 *
 * tsup wraps esbuild for fast, zero-config bundling. We emit:
 * - ESM (target ES2022, no CJS — modern Node only)
 * - .d.ts type declarations (via the built-in dts plugin)
 * - sourcemaps for debugging
 *
 * The CLI is built as a separate entry from the library so end users
 * who only want the library API don't pull in the CLI code, and vice
 * versa. The 'shims: false' keeps the bundle tiny — Node 18+ has
 * its own fetch, AbortController, etc.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'cli/index': 'src/cli/index.ts',
  },
  format: ['esm'],
  target: 'node18',
  dts: true,
  sourcemap: true,
  clean: true,
  shims: false,
  splitting: false,
  treeshake: true,
  // The CLI bundle needs a shebang to be executable when installed
  // via npm. tsup's per-entry banner injects it at the top of the
  // emitted JS. Without this, npm strips the bin entry on publish
  // (we saw the warning in v0.1.0's publish output).
  banner: {
    js: '#!/usr/bin/env node',
  },
  // Externalize peer dependencies so the bundle stays small and
  // consumers can use their own versions if needed.
  external: ['@anthropic-ai/sdk', 'openai'],
});
