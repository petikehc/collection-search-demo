import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { S3Client } from '@aws-sdk/client-s3';
import { toKbFiles } from '../lib/kb/documents.js';
import { syncKbFiles } from '../lib/kb/sync.js';
import { NmaClient } from '../lib/nma/client.js';
import { type CollectionObject, normaliseObject } from '../lib/nma/normalise.js';
import { fetchMissingPinned } from '../lib/nma/pinned.js';
import { DEFAULT_SAMPLE_SLICES, fetchSample } from '../lib/nma/sample.js';
import { createOpenSearchClient } from '../lib/opensearch/client.js';
import { OBJECTS_ALIAS } from '../lib/search/constants.js';
import { createEmbedder, embedAll, embeddingText } from '../lib/search/embed.js';
import { readObjects, reindex, toSearchDocument } from '../lib/search/reindex.js';

export interface IngestEvent {
  /**
   * Rebuild from the objects already in this index (e.g. `objects-20261110235504`) and skip
   * the fetch: for a mapping or embedding change, which shouldn't change the data. The Museum's
   * result order moves when its data is updated, so a fresh fetch draws a different sample.
   */
  reindexFrom?: string;
}

/**
 * Full ingest: fetch a sample from the Museum's Collection API, normalise it, embed each object
 * for hybrid search, rebuild the search index behind the `objects` alias with no downtime, and
 * sync the Knowledge Base documents in S3.
 * Invoked by `pnpm ingest`; the KB then picks up the changes with `pnpm kb:sync`.
 */
export async function handler(event: IngestEvent = {}) {
  const started = Date.now();
  const client = createOpenSearchClient({
    endpoint: process.env.DOMAIN_ENDPOINT ?? '',
    region: process.env.AWS_REGION ?? '',
  });

  let fetched: number;
  let objects: CollectionObject[];
  let pinned: { added: number; withdrawn: string[] } | undefined;
  if (event.reindexFrom) {
    if (!new RegExp(`^${OBJECTS_ALIAS}-\\d{14}$`).test(event.reindexFrom)) {
      throw new Error(`reindexFrom must be a versioned index like ${OBJECTS_ALIAS}-20261110235504`);
    }
    objects = await readObjects(client, event.reindexFrom);
    if (objects.length === 0) throw new Error(`Index ${event.reindexFrom} has no objects`);
    fetched = objects.length;
  } else {
    const nma = new NmaClient({ apiKey: process.env.NMA_API_KEY || undefined });
    const sample = await fetchSample(nma, { slices: DEFAULT_SAMPLE_SLICES });
    // The eval set's and the demo's objects, whatever the sample drew (lib/nma/pinned.ts).
    const extra = await fetchMissingPinned(nma, new Set(sample.map((o) => o.id)));
    pinned = { added: extra.objects.length, withdrawn: extra.withdrawn };
    const raw = [...sample, ...extra.objects];
    const retrievedAt = new Date().toISOString();
    objects = raw
      .map((r) => normaliseObject(r, retrievedAt))
      .filter((o): o is CollectionObject => o !== null);
    fetched = raw.length;
  }
  const embedStarted = Date.now();
  const vectors = await embedAll(
    objects.map(embeddingText),
    createEmbedder(new BedrockRuntimeClient({})),
  );
  const embedSeconds = Math.round((Date.now() - embedStarted) / 1000);
  const result = await reindex(
    client,
    objects.map((obj, i) => toSearchDocument(obj, vectors[i])),
  );

  // After the index swap: if this fails, search is already updated and the next run retries.
  const kbSync = await syncKbFiles(
    new S3Client({}),
    process.env.DOCS_BUCKET ?? '',
    objects.flatMap(toKbFiles),
  );

  const summary = {
    ...result,
    kbSync,
    source: event.reindexFrom ?? 'Collection API',
    ...(pinned && { pinned }),
    fetched,
    dropped: fetched - objects.length,
    embedSeconds,
    seconds: Math.round((Date.now() - started) / 1000),
  };
  console.log(JSON.stringify({ message: 'ingest complete', ...summary }));
  return summary;
}
