import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const work = mkdtempSync(join(tmpdir(), 'kb-smoke-'));
const out = join(work, 'smoke.mjs');

await build({
  entryPoints: [join(here, 'smoke-combat.ts')],
  outfile: out,
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { phaser: join(here, 'phaser-stub.mjs') },
  logLevel: 'warning',
});

await import(pathToFileURL(out).href);
rmSync(work, { recursive: true, force: true });
