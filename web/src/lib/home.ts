/**
 * What the home page shows: the collection's size, the filter options, and a few objects with
 * images. Cached for an hour per server instance, so the home page (the one page crawlers may
 * index) costs two API calls an hour, however often it's loaded.
 */
import { type SearchResponse, search } from './api.js';

export interface HomeData {
  total: number;
  facets: SearchResponse['facets'];
  featured: SearchResponse['results'];
}

const HOUR = 3600_000;
const FEATURED = 8;
let cached: { data: HomeData; expiresAt: number } | undefined;

/** A different page of image-bearing objects each day (UTC), the same all day. */
export function featuredPage(withImages: number, now: Date, perPage = FEATURED): number {
  const pages = Math.max(1, Math.min(100, Math.floor(withImages / perPage)));
  const day = Math.floor(now.getTime() / (24 * HOUR));
  return (day % pages) + 1;
}

export async function getHomeData(now = new Date()): Promise<HomeData> {
  if (cached && cached.expiresAt > now.getTime()) return cached.data;
  const everything = await search({ size: 1, mode: 'keyword' });
  const withImages = await search({ size: 1, hasImage: true, mode: 'keyword' });
  const featured = await search({
    size: FEATURED,
    hasImage: true,
    mode: 'keyword',
    page: featuredPage(withImages.total, now),
  });
  const data = { total: everything.total, facets: everything.facets, featured: featured.results };
  cached = { data, expiresAt: now.getTime() + HOUR };
  return data;
}
