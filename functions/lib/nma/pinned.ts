import type { NmaClient } from './client.js';
import pinned from './pinned-objects.json' with { type: 'json' };
import type { NmaObject } from './types.js';

/**
 * Objects every ingest includes, whatever the sample draws: the eval set's expected objects and
 * the ones the walkthrough uses. The sample is drawn from pages spread across the Museum's
 * results, and those move when the Museum updates its data: one re-ingest kept only 10% of the
 * previous day's objects, and 23 of the eval set's 252. Without these, a rebuild after teardown
 * would quietly break the eval and the demo.
 */
export const PINNED_OBJECT_IDS: string[] = [...new Set([...pinned.eval, ...pinned.demo])];

/**
 * Fetches the pinned objects the sample doesn't already have, one request each (the API can't
 * fetch several IDs at once). Withdrawn objects (404/410) are skipped and counted.
 */
export async function fetchMissingPinned(
  client: NmaClient,
  have: Set<string>,
  ids: string[] = PINNED_OBJECT_IDS,
): Promise<{ objects: NmaObject[]; withdrawn: string[] }> {
  const objects: NmaObject[] = [];
  const withdrawn: string[] = [];
  for (const id of ids) {
    if (have.has(id)) continue;
    const { object } = await client.getObject(id);
    if (object) objects.push(object);
    else withdrawn.push(id);
  }
  return { objects, withdrawn };
}
