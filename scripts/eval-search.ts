/**
 * Compares keyword and hybrid search through the deployed API (GET /search), and writes
 * evals/results/<date>-search-<label>.md.
 *
 *   pnpm eval:search --label hybrid
 *
 * Two measures, because hybrid search can fail in two directions:
 * - Questions (evals/questions.jsonl, the answerable ones): recall@10 and hit@10 of the objects
 *   each question should find. Keyword search is weak here; the vector half should fix it.
 * - Keywords (evals/search-keywords.json): of the first 10 results, the share that contain the
 *   words at all. Keyword search scores 100% by definition; hybrid must not trade that away by
 *   ranking look-alikes above exact matches.
 *
 * Costs a fraction of a cent (one small embedding per hybrid query).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import type { components } from '../functions/lib/api/types.gen.js';
import { callApi } from './lib/api.js';
import { type EvalCase, recallAt } from './lib/eval-score.js';

type SearchResponse = components['schemas']['SearchResponse'];
const TOP = 10;
const MODES = ['keyword', 'hybrid'] as const;

const { values } = parseArgs({ options: { label: { type: 'string', default: 'run' } } });
const root = new URL('../evals/', import.meta.url);
const questions: EvalCase[] = (await readFile(new URL('questions.jsonl', root), 'utf8'))
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as EvalCase)
  .filter((c) => c.expect === 'answer' && (c.expectedObjectIds?.length ?? 0) > 0);
const keywords: string[] = JSON.parse(
  await readFile(new URL('search-keywords.json', root), 'utf8'),
);

async function search(
  q: string,
  mode: string,
  size = TOP,
): Promise<SearchResponse & { ms: number }> {
  const query = new URLSearchParams({ q, mode, size: String(size) });
  const res = await callApi('GET', `/search?${query}`);
  if (res.status !== 200) throw new Error(`search ${mode} "${q}" → HTTP ${res.status}`);
  return { ...(res.json as SearchResponse), ms: res.ms };
}
const ids = (r: SearchResponse) => r.results.map((x) => x.id);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

const questionRows: string[] = [];
const totals = Object.fromEntries(
  MODES.map((m) => [m, { recall: [] as number[], hit: [] as number[], ms: [] as number[] }]),
);
for (const c of questions) {
  const cells: string[] = [];
  for (const mode of MODES) {
    const res = await search(c.question, mode);
    const recall = recallAt(c.expectedObjectIds ?? [], ids(res), TOP);
    totals[mode]?.recall.push(recall);
    totals[mode]?.hit.push(recall > 0 ? 1 : 0);
    totals[mode]?.ms.push(res.ms);
    cells.push(pct(recall));
  }
  questionRows.push(`| ${c.id} | ${c.question} | ${cells.join(' | ')} |`);
}

const keywordRows: string[] = [];
const precision: number[] = [];
for (const q of keywords) {
  // Every object that contains the words (the API returns at most 50 a page).
  const matching = new Set(ids(await search(q, 'keyword', 50)));
  const hybrid = await search(q, 'hybrid');
  const first = ids(hybrid).slice(0, Math.min(TOP, matching.size) || TOP);
  const share = matching.size ? first.filter((id) => matching.has(id)).length / first.length : 0;
  precision.push(share);
  // With more matches than one page can list, some matching results go unrecognised.
  const atLeast = hybrid.keywordTotal > matching.size ? 'at least ' : '';
  keywordRows.push(
    `| ${q} | ${hybrid.keywordTotal} | ${hybrid.total - hybrid.keywordTotal} | ${atLeast}${pct(share)} |`,
  );
}

const date = new Date().toISOString().slice(0, 10);
const summary = MODES.map((mode) => {
  const t = totals[mode];
  return `| ${mode} | ${pct(mean(t?.recall ?? []))} | ${pct(mean(t?.hit ?? []))} | ${mode === 'keyword' ? '100%' : pct(mean(precision))} | ${Math.round(mean(t?.ms ?? []))} ms |`;
});
const lines = [
  `# Search eval: ${values.label} (${date})`,
  '',
  `${questions.length} questions and ${keywords.length} keyword queries, through the deployed \`GET /search\`.`,
  '',
  `| Mode | Question recall@${TOP} | Question hit@${TOP} | Keyword precision@${TOP} | Mean round trip |`,
  '| --- | --- | --- | --- | --- |',
  ...summary,
  '',
  '## Questions',
  '',
  `| Case | Question | Keyword recall@${TOP} | Hybrid recall@${TOP} |`,
  '| --- | --- | --- | --- |',
  ...questionRows,
  '',
  '## Keywords (hybrid mode)',
  '',
  `| Query | Objects matching the words | Extra objects by meaning | First ${TOP} that match the words |`,
  '| --- | --- | --- | --- |',
  ...keywordRows,
  '',
  '"At least": the query matches more objects than the 50 the API lists per page, so some of the',
  'first 10 may match the words without being recognised here. The summary figure is a lower bound.',
  '',
];
const dir = new URL('results/', root);
await mkdir(dir, { recursive: true });
const file = `${date}-search-${values.label}.md`;
await writeFile(new URL(file, dir), lines.join('\n'));
console.log(lines.slice(4, 8).join('\n'));
console.log(`\nWrote evals/results/${file}`);
