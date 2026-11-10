import { NmaClient } from '../lib/nma/client.js';
import { type CollectionObject, normaliseObject } from '../lib/nma/normalise.js';
import { DEFAULT_SAMPLE_SLICES, fetchSample } from '../lib/nma/sample.js';
import { createOpenSearchClient } from '../lib/opensearch/client.js';
import { reindex, toSearchDocument } from '../lib/search/reindex.js';

/**
 * Full ingest: fetch a sample from the Museum's Collection API, normalise it, and rebuild the
 * search index behind the `objects` alias with no downtime. Invoked by `pnpm ingest`.
 */
export async function handler() {
  const started = Date.now();
  const nma = new NmaClient({ apiKey: process.env.NMA_API_KEY || undefined });
  const raw = await fetchSample(nma, { slices: DEFAULT_SAMPLE_SLICES });

  const retrievedAt = new Date().toISOString();
  const objects = raw
    .map((r) => normaliseObject(r, retrievedAt))
    .filter((o): o is CollectionObject => o !== null);

  const client = createOpenSearchClient({
    endpoint: process.env.DOMAIN_ENDPOINT ?? '',
    region: process.env.AWS_REGION ?? '',
  });
  const result = await reindex(client, objects.map(toSearchDocument));

  const summary = {
    ...result,
    fetched: raw.length,
    dropped: raw.length - objects.length,
    seconds: Math.round((Date.now() - started) / 1000),
  };
  console.log(JSON.stringify({ message: 'ingest complete', ...summary }));
  return summary;
}
