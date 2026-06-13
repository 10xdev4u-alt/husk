/**
 * Example 06 — `husk init` programmatic demo.
 *
 * Runs the same scaffolding the CLI does, but in-process so you can
 * inspect the returned InitResult without writing to your working dir.
 *
 *   bun run examples/06-husk-init/index.ts
 *
 * The CLI equivalent is:
 *
 *   husk init my-agent
 *   husk init my-agent --provider openai --template full
 *
 * This file exists to show that the init module is also usable as
 * a library — e.g. for a 'create-husk' Yeoman-style generator, or
 * an in-memory template preview.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initCommand } from '../../src/cli/init.js';

async function main() {
  const work = await mkdtemp(join(tmpdir(), 'husk-init-demo-'));
  const target = join(work, 'my-agent');

  console.log(`\n→ Scaffolding into ${target}\n`);

  const result = await initCommand({
    target,
    provider: 'anthropic',
    template: 'full',
  });

  console.log(`✓ Scaffolded ${result.template} Husk project`);
  console.log(`  Provider: ${result.provider}`);
  console.log(`  Files:    ${result.files.length}\n`);

  for (const f of result.files) {
    console.log(`    - ${f}`);
  }

  // Show a couple of the generated files so the user sees real content.
  const hello = await readFile(join(result.projectDir, 'src/hello-agent.ts'), 'utf-8');
  console.log('\n--- src/hello-agent.ts ---\n');
  console.log(hello);

  const pkg = JSON.parse(await readFile(join(result.projectDir, 'package.json'), 'utf-8'));
  console.log('--- package.json (highlights) ---\n');
  console.log(`  name:        ${pkg.name}`);
  console.log(`  type:        ${pkg.type}`);
  console.log(`  husk dep:    ${pkg.dependencies['@princetheprogrammerbtw/husk']}`);
  console.log(`  scripts:     ${Object.keys(pkg.scripts).join(', ')}`);

  // Clean up — this is a demo, not a real project.
  await rm(work, { recursive: true, force: true });
  console.log(`\n✓ Cleaned up ${work}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
