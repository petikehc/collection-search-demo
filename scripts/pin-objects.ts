/**
 * Regenerates the eval part of functions/lib/nma/pinned-objects.json from evals/questions.jsonl,
 * so every ingest includes the objects the eval set expects. Run it after changing the eval set
 * (a test fails until you do). The demo list is kept as it is.
 *
 *   pnpm pin:objects
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = new URL('../functions/lib/nma/pinned-objects.json', import.meta.url);
const pinned = JSON.parse(readFileSync(file, 'utf8')) as {
  _about: string;
  eval: string[];
  demo: string[];
};
const ids = new Set<string>();
for (const line of readFileSync(new URL('../evals/questions.jsonl', import.meta.url), 'utf8').split(
  '\n',
)) {
  if (line.trim()) for (const id of JSON.parse(line).expectedObjectIds ?? []) ids.add(id);
}
const before = pinned.eval.length;
pinned.eval = [...ids].sort((a, b) => Number(a) - Number(b));
pinned.demo = pinned.demo.filter((id) => !ids.has(id));
writeFileSync(file, `${JSON.stringify(pinned, null, 2)}\n`);
// In the repository's own format, so the regenerated file passes lint.
spawnSync('pnpm', ['exec', 'biome', 'format', '--write', fileURLToPath(file)], { stdio: 'ignore' });
console.log(
  `Pinned ${pinned.eval.length} eval objects (was ${before}) and ${pinned.demo.length} more for the demo.`,
);
