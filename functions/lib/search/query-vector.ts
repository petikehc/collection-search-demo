import type { Embed } from './embed.js';

/**
 * Remembers the most recent vectors, so paging or filtering the same search doesn't embed the
 * same words again. Failures aren't remembered. Maps keep insertion order: the first key is
 * the oldest.
 */
export function cached(embed: Embed, maxEntries = 200): Embed {
  const vectors = new Map<string, number[]>();
  return async (text) => {
    const hit = vectors.get(text);
    if (hit) return hit;
    const vector = await embed(text);
    if (vectors.size >= maxEntries) vectors.delete(vectors.keys().next().value ?? '');
    vectors.set(text, vector);
    return vector;
  };
}
