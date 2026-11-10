/**
 * Local dry run of the ingest: fetches a varied sample from the Museum's Collection API,
 * normalises it and writes data/objects.jsonl (gitignored), then prints field coverage.
 *
 *   pnpm fetch-sample            # ~2,000 objects with images + ~2,000 from the whole collection
 *   NMA_API_KEY=... pnpm fetch-sample
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { NmaClient } from '../functions/lib/nma/client.js';
import { type CollectionObject, normaliseObject } from '../functions/lib/nma/normalise.js';
import { fetchSample } from '../functions/lib/nma/sample.js';

const OUT_FILE = new URL('../data/objects.jsonl', import.meta.url);

const client = new NmaClient({ apiKey: process.env.NMA_API_KEY || undefined });
const started = Date.now();

const raw = await fetchSample(client, {
  slices: [
    { query: 'media=*', count: 2000 },
    { query: 'text=*', count: 2000 },
  ],
  onPage: ({ query, offset, received }) =>
    console.log(`  ${query.padEnd(8)} offset ${String(offset).padStart(6)}: ${received}`),
});

const retrievedAt = new Date().toISOString();
const objects = raw
  .map((r) => normaliseObject(r, retrievedAt))
  .filter((o): o is CollectionObject => o !== null);

await mkdir(new URL('.', OUT_FILE), { recursive: true });
await writeFile(OUT_FILE, `${objects.map((o) => JSON.stringify(o)).join('\n')}\n`);

const pct = (n: number) => `${((100 * n) / objects.length).toFixed(0)}%`.padStart(4);
const has = (pick: (o: CollectionObject) => unknown) =>
  objects.filter((o) => {
    const v = pick(o);
    return Array.isArray(v) ? v.length > 0 : v !== undefined;
  }).length;

console.log(
  `\nFetched ${raw.length} unique records in ${((Date.now() - started) / 1000).toFixed(0)} s`,
);
console.log(
  `Kept ${objects.length} (dropped ${raw.length - objects.length} without title or link)`,
);
console.log(`Wrote ${OUT_FILE.pathname}\n\nField coverage:`);
const fields: [string, (o: CollectionObject) => unknown][] = [
  ['types', (o) => o.types],
  ['collection', (o) => o.collection],
  ['materials', (o) => o.materials],
  ['places', (o) => o.places],
  ['creators', (o) => o.creators],
  ['yearStart', (o) => o.yearStart],
  ['physicalDescription', (o) => o.physicalDescription],
  ['contentDescription', (o) => o.contentDescription],
  ['description', (o) => o.description],
  ['significanceStatement', (o) => o.significanceStatement],
  ['images', (o) => o.images],
];
for (const [name, pick] of fields) console.log(`  ${name.padEnd(22)} ${pct(has(pick))}`);

const topTypes = new Map<string, number>();
for (const o of objects) for (const t of o.types) topTypes.set(t, (topTypes.get(t) ?? 0) + 1);
console.log(
  `\nDistinct types: ${topTypes.size}. Top 10:`,
  [...topTypes].sort((a, b) => b[1] - a[1]).slice(0, 10),
);
