import type { NmaClient } from './client.js';
import type { NmaObject } from './types.js';

export interface SampleSlice {
  /** Query string for /object, e.g. "media=*" (objects with images) or "text=*" (everything). */
  query: string;
  count: number;
}

/** About 2,000 objects with images plus about 2,000 from the whole collection. */
export const DEFAULT_SAMPLE_SLICES: SampleSlice[] = [
  { query: 'media=*', count: 2000 },
  { query: 'text=*', count: 2000 },
];

export interface SampleOptions {
  slices: SampleSlice[];
  pageSize?: number;
  onPage?: (info: { query: string; offset: number; received: number }) => void;
}

/**
 * Fetches a varied sample: for each slice, pages spread evenly across all matching results,
 * rather than just the first N (which come back in one relevance order). Objects found by more
 * than one slice are kept once.
 *
 * The sample is only stable while the Museum's data is: after one of its updates, the same
 * offsets returned mostly different objects (10% of one sample was in the next day's).
 */
export async function fetchSample(client: NmaClient, options: SampleOptions): Promise<NmaObject[]> {
  const pageSize = options.pageSize ?? 100;
  const byId = new Map<string, NmaObject>();

  for (const { query, count } of options.slices) {
    const first = await client.getPage(`object?${query}&limit=1`);
    const total = first.meta?.results ?? 0;
    const pages = Math.ceil(count / pageSize);

    for (const offset of evenlySpacedOffsets(total, pages, pageSize)) {
      const page = await client.getPage(`object?${query}&limit=${pageSize}&offset=${offset}`);
      for (const obj of page.data) byId.set(obj.id, obj);
      options.onPage?.({ query, offset, received: page.data.length });
    }
  }

  return [...byId.values()];
}

/** Offsets of `pages` pages picked evenly from all pages of `total` results, first and last included. */
export function evenlySpacedOffsets(total: number, pages: number, pageSize: number): number[] {
  const pageCount = Math.ceil(total / pageSize);
  const n = Math.min(pages, pageCount);
  if (n <= 0) return [];
  if (n === 1) return [0];

  return Array.from(
    { length: n },
    (_, i) => Math.round((i * (pageCount - 1)) / (n - 1)) * pageSize,
  );
}
