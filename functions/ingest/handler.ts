import { S3Client } from '@aws-sdk/client-s3';
import { toKbFiles } from '../lib/kb/documents.js';
import { syncKbFiles } from '../lib/kb/sync.js';
import { NmaClient } from '../lib/nma/client.js';
import { type CollectionObject, normaliseObject } from '../lib/nma/normalise.js';
import { DEFAULT_SAMPLE_SLICES, fetchSample } from '../lib/nma/sample.js';
import { createOpenSearchClient } from '../lib/opensearch/client.js';
import { reindex, toSearchDocument } from '../lib/search/reindex.js';

/**
 * Full ingest: fetch a sample from the Museum's Collection API, normalise it, rebuild the search
 * index behind the `objects` alias with no downtime, and sync the Knowledge Base documents in S3.
 * Invoked by `pnpm ingest`; the KB then picks up the changes with `pnpm kb:sync`.
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

  // After the index swap: if this fails, search is already updated and the next run retries.
  const kbFiles = await syncKbFiles(
    new S3Client({}),
    process.env.DOCS_BUCKET ?? '',
    objects.flatMap(toKbFiles),
  );

  const summary = {
    ...result,
    kbFiles,
    fetched: raw.length,
    dropped: raw.length - objects.length,
    seconds: Math.round((Date.now() - started) / 1000),
  };
  console.log(JSON.stringify({ message: 'ingest complete', ...summary }));
  return summary;
}
