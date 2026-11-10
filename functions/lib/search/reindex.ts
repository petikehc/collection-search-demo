import type { API, Client } from '@opensearch-project/opensearch';
import type { CollectionObject } from '../nma/normalise.js';
import { OBJECTS_ALIAS } from './constants.js';
import objectsIndex from './objects-index.json' with { type: 'json' };

/** Mappings, analysers and synonyms. JSON imports widen string literals, hence the cast. */
const indexDefinition = objectsIndex as API.Indices_Create_RequestBody;

export type SearchDocument = CollectionObject & { hasImage: boolean };

export interface ReindexResult {
  index: string;
  previous: string[];
  count: number;
  deleted: string[];
}

export function toSearchDocument(obj: CollectionObject): SearchDocument {
  return { ...obj, hasImage: obj.images.length > 0 };
}

/** e.g. objects-20261111093000 (UTC), so names sort by creation time. */
export function newIndexName(alias: string, now = new Date()): string {
  return `${alias}-${now.toISOString().replace(/\D/g, '').slice(0, 14)}`;
}

/** One atomic _aliases request: readers see either the old index or the new one, never neither. */
export function aliasSwapActions(alias: string, current: string[], next: string) {
  return [
    ...current.map((index) => ({ remove: { index, alias } })),
    { add: { index: next, alias, is_write_index: true } },
  ];
}

/** Old versioned indices to delete: everything except the live one and the newest `keep` others. */
export function indicesToPrune(alias: string, all: string[], live: string, keep: number): string[] {
  const versioned = all
    .filter((i) => i.startsWith(`${alias}-`) && i !== live)
    .sort()
    .reverse();
  return versioned.slice(keep);
}

/** NDJSON body for the _bulk API: an action line, then the document, for each object. */
export function bulkBody(index: string, docs: SearchDocument[]): object[] {
  return docs.flatMap((doc) => [{ index: { _index: index, _id: doc.id } }, doc]);
}

/**
 * Zero-downtime full reindex:
 * create a new versioned index → bulk load → refresh and verify the count → swap the alias
 * atomically → prune old indices (keeping one previous index for rollback).
 */
export async function reindex(
  client: Client,
  docs: SearchDocument[],
  options: { alias?: string; keepPrevious?: number; batchSize?: number; now?: Date } = {},
): Promise<ReindexResult> {
  const alias = options.alias ?? OBJECTS_ALIAS;
  const index = newIndexName(alias, options.now);
  const batchSize = options.batchSize ?? 500;

  await client.indices.create({ index, body: indexDefinition });
  let previous: string[];
  try {
    for (let i = 0; i < docs.length; i += batchSize) {
      const res = await client.bulk({ body: bulkBody(index, docs.slice(i, i + batchSize)) });
      if (res.body.errors) {
        const failed = res.body.items.find((item) => item.index?.error)?.index;
        throw new Error(
          `Bulk indexing failed for ${failed?._id}: ${JSON.stringify(failed?.error)}`,
        );
      }
    }
    await client.indices.refresh({ index });
    const count = Number((await client.count({ index })).body.count);
    if (count !== docs.length) {
      throw new Error(`Index ${index} has ${count} documents, expected ${docs.length}`);
    }

    previous = await aliasTargets(client, alias);
    await client.indices.updateAliases({
      body: { actions: aliasSwapActions(alias, previous, index) },
    });
  } catch (err) {
    // Until the alias points at it, the new index is unused: remove it rather than orphan it.
    await client.indices.delete({ index }).catch(() => undefined);
    throw err;
  }

  // From here the new index is live, so a failure must never delete it.
  const all = Object.keys((await client.indices.get({ index: `${alias}-*` })).body);
  const deleted = indicesToPrune(alias, all, index, options.keepPrevious ?? 1);
  if (deleted.length) await client.indices.delete({ index: deleted });

  return { index, previous, count: docs.length, deleted };
}

/**
 * Indices the alias points at now. Scoped to `<alias>-*`: an unscoped `_alias/<name>` request
 * resolves against every index, which a least-privilege role isn't allowed to see.
 */
async function aliasTargets(client: Client, alias: string): Promise<string[]> {
  const scope = { index: `${alias}-*`, name: alias };
  const exists = await client.indices.existsAlias(scope);
  if (!exists.body) return [];
  return Object.keys((await client.indices.getAlias(scope)).body);
}
