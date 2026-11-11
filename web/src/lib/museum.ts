/**
 * Object pages read the record live from the Museum's Collection API (its terms prefer live
 * calls), and keep it only as long as the Museum's Cache-Control allows (12 hours today).
 */
import { NmaClient } from '../../../functions/lib/nma/client.js';
import { type CollectionObject, normaliseObject } from '../../../functions/lib/nma/normalise.js';

// A page view shouldn't wait out the ingest's long backoff: one retry, then show an error.
// A slow Museum fails after 5 s rather than holding the request (and a Lambda) for 30.
// 10 requests a second is the API's per-second limit.
const client = new NmaClient({ minIntervalMs: 100, maxRetries: 1, timeoutMs: 5000 });

const MAX_ENTRIES = 500;
const cache = new Map<string, { object: CollectionObject; expiresAt: number }>();

/** The object, or null if the Museum has withdrawn it or it never existed. */
export async function getObject(id: string): Promise<CollectionObject | null> {
  const hit = cache.get(id);
  if (hit && hit.expiresAt > Date.now()) return hit.object;
  cache.delete(id);

  const { object: raw, maxAgeSeconds } = await client.getObject(id);
  const object = raw ? normaliseObject(raw, new Date().toISOString()) : null;
  if (object && maxAgeSeconds > 0) {
    // Maps keep insertion order, so the first key is the oldest entry.
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value ?? '');
    cache.set(id, { object, expiresAt: Date.now() + maxAgeSeconds * 1000 });
  }
  return object;
}
