/**
 * Regression test for the analysers in functions/lib/search/objects-index.json, run on the live
 * domain (analysis happens inside OpenSearch, so it can't be unit-tested locally).
 * Creates a throwaway index from the definition, checks the tokens for each case, deletes it.
 *
 *   pnpm check:analysis
 */
import { readFile } from 'node:fs/promises';
import { createOpenSearchClient } from '../functions/lib/opensearch/client.js';
import { getStackOutputs, REGION } from './lib/stack-outputs.js';

type Case = { analyzer: 'collection_text' | 'collection_search'; text: string; tokens: string[] };

const CASES: Case[] = [
  // Indexing: possessives, stop words, plurals and accents.
  {
    analyzer: 'collection_text',
    text: "The Boomerang's carvings",
    tokens: ['boomerang', 'carving'],
  },
  { analyzer: 'collection_text', text: 'Café', tokens: ['cafe'] },
  // Synonyms, including on stemmed forms (synonyms run after the stemmer).
  { analyzer: 'collection_search', text: 'kylie', tokens: ['boomerang', 'kylie'] },
  { analyzer: 'collection_search', text: 'boomerangs', tokens: ['boomerang', 'kylie'] },
  { analyzer: 'collection_search', text: 'photos', tokens: ['photo', 'photograph'] },
  { analyzer: 'collection_search', text: 'carved', tokens: ['carve', 'carving'] },
  {
    analyzer: 'collection_search',
    text: 'spear throwers',
    tokens: ['spear', 'spearthrower', 'throw', 'woomera'],
  },
  // kstem stays precise where porter would conflate.
  { analyzer: 'collection_search', text: 'university', tokens: ['university'] },
  { analyzer: 'collection_search', text: 'organic', tokens: ['organic'] },
];

const outputs = await getStackOutputs('CollectionSearch-Search');
const client = createOpenSearchClient({
  endpoint: outputs.DomainEndpoint ?? '',
  region: REGION,
  assumeRoleArn: outputs.AdminRoleArn,
});

const index = `analysis-check-${Date.now()}`;
const definition = JSON.parse(
  await readFile(new URL('../functions/lib/search/objects-index.json', import.meta.url), 'utf8'),
);
await client.indices.create({ index, body: definition });

let failures = 0;
try {
  for (const { analyzer, text, tokens } of CASES) {
    const res = await client.indices.analyze({ index, body: { analyzer, text } });
    const actual = [...new Set((res.body.tokens ?? []).map((t) => t.token))].sort();
    const ok = JSON.stringify(actual) === JSON.stringify([...tokens].sort());
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${analyzer.padEnd(17)} "${text}" → ${actual.join(', ')}`);
    if (!ok) console.log(`      expected ${[...tokens].sort().join(', ')}`);
  }
} finally {
  await client.indices.delete({ index });
}

console.log(`\n${CASES.length - failures}/${CASES.length} analysis cases passed`);
if (failures) process.exitCode = 1;
