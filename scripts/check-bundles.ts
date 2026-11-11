/**
 * Loads every synthesised Lambda bundle in a clean Node process, in an empty directory with no
 * node_modules, like the Lambda runtime does, and starts the web front end's server the same way.
 * Catches "Cannot find module" errors that unit tests miss (they run the TypeScript with every
 * dependency installed).
 *
 *   pnpm check:bundles      # synthesises first
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
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

// The web front end's asset (WebStack): start its Astro server the way the Lambda Web Adapter
// does, from a copy with no node_modules and no AWS credentials, and request a page. A 404 for an
// unknown path proves the server starts and renders without anything outside the bundle.
const web = readdirSync(CDK_OUT).find((d) => existsSync(join(CDK_OUT, d, 'run.sh')));
if (!web) throw new Error('No web front end asset found: run `pnpm synth` first');
const webDir = mkdtempSync(join(tmpdir(), 'web-check-'));
cpSync(join(CDK_OUT, web), webDir, { recursive: true });
const port = 18080;
const server = spawn(process.execPath, ['dist/server/entry.mjs'], {
  cwd: webDir,
  env: { PATH: ENV.PATH, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production' },
  stdio: 'ignore',
});
try {
  let status = 0;
  for (let i = 0; i < 50 && !status; i++) {
    status = await fetch(`http://127.0.0.1:${port}/bundle-check`)
      .then((r) => r.status)
      .catch(() => new Promise<number>((resolve) => setTimeout(() => resolve(0), 200)));
  }
  const ok = status === 404;
  if (!ok) process.exitCode = 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  web front end server  (GET /bundle-check → ${status || 'no answer'})`,
  );
} finally {
  server.kill();
  rmSync(webDir, { recursive: true, force: true });
}
