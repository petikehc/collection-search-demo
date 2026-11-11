/**
 * Loads every synthesised Lambda bundle in a clean Node process, in an empty directory with no
 * node_modules, like the Lambda runtime does. Catches "Cannot find module" errors that unit
 * tests miss (they run the TypeScript with every dependency installed).
 *
 *   pnpm check:bundles      # synthesises first
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CDK_OUT = new URL('../infra/cdk.out/', import.meta.url).pathname;

// Placeholders for values the handlers read at load time.
const ENV = {
  PATH: process.env.PATH ?? '',
  AWS_REGION: 'ap-southeast-2',
  DOMAIN_ENDPOINT: 'search-example.ap-southeast-2.es.amazonaws.com',
};

// Only our own bundles (built with source maps). CDK's built-in handlers, such as the one that
// empties a bucket on delete, are designed to use the SDK in the Lambda runtime.
const assets = readdirSync(CDK_OUT).filter(
  (d) => d.startsWith('asset.') && existsSync(join(CDK_OUT, d, 'index.js.map')),
);
if (assets.length === 0) throw new Error('No Lambda bundles found: run `pnpm synth` first');

let failures = 0;
for (const asset of assets) {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-check-'));
  try {
    copyFileSync(join(CDK_OUT, asset, 'index.js'), join(dir, 'index.js'));
    const run = spawnSync(process.execPath, ['-e', "require('./index.js')"], {
      cwd: dir,
      env: ENV,
      encoding: 'utf8',
    });
    const kb = Math.round(statSync(join(dir, 'index.js')).size / 1024);
    const ok = run.status === 0;
    if (!ok) failures++;
    const reason = ok
      ? ''
      : `  ${run.stderr
          .split('\n')
          .find((l) => /Error/.test(l))
          ?.trim()}`;
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${asset.slice(0, 18)}  ${String(kb).padStart(5)} KB${reason}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${assets.length - failures}/${assets.length} bundles load`);
if (failures) process.exitCode = 1;
