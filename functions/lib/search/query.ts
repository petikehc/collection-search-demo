import type { components } from '../api/types.gen.js';
import {
  HYBRID_DEPTH,
  HYBRID_NEIGHBOURS,
  HYBRID_QUESTION_PIPELINE,
  OBJECTS_ALIAS,
} from './constants.js';
import { looksLikeQuestion } from './question.js';

type SearchResponse = components['schemas']['SearchResponse'];
type SearchResult = components['schemas']['SearchResult'];

export const ATTRIBUTION =
  "This application was developed using the National Museum of Australia's Collection API. " +
  'Collection metadata © National Museum of Australia, CC BY-NC 4.0.';

/**
 * Fields searched, with boosts: an exact accession number (a keyword field, so only a whole-value
 * match counts) beats everything; then title; the collection-level statement counts least.
 */
export const SEARCH_FIELDS = [
  'accessionNumber^10',
  'title^4',
  'types^3',
  'places^2',
  'materials^2',
  'collection^1.5',
  'physicalDescription',
  'contentDescription',
  'description',
  'significanceStatement^0.3',
];

const RESULT_FIELDS = [
  'id',
  'title',
  'types',
  'collection',
  'places',
  'dateLabel',
  'yearStart',
  'yearEnd',
  'images',
  'sourceUrl',
  'retrievedAt',
];

export interface SearchParams {
  q?: string;
  type?: string;
  place?: string;
  yearFrom?: number;
  yearTo?: number;
  hasImage?: boolean;
  /** `hybrid` blends keyword and vector matches when there's a query; `keyword` never does. */
  mode: 'hybrid' | 'keyword';
  page: number;
  size: number;
}

export type ParseResult = { ok: true; params: SearchParams } | { ok: false; message: string };

/**
 * Validates query string parameters against the same limits as openapi.yaml.
 * API Gateway's REST request validator only checks that required parameters are present,
 * not their types or ranges, so the Lambda has to check them itself.
 */
export function parseSearchParams(raw: Record<string, string | undefined> | null): ParseResult {
  const query = raw ?? {};
  const text = (name: string): string | undefined | Error => {
    const value = query[name]?.trim();
    if (!value) return undefined;
    return value.length > 200 ? new Error(`${name} must be at most 200 characters`) : value;
  };
  const int = (name: string, min: number, max: number, fallback?: number) => {
    const value = query[name];
    if (value === undefined || value === '') return fallback;
    const n = Number(value);
    return Number.isInteger(n) && n >= min && n <= max
      ? n
      : new Error(`${name} must be an integer from ${min} to ${max}`);
  };

  const choice = <T extends string>(name: string, options: readonly T[], fallback: T) => {
    const value = query[name];
    if (value === undefined || value === '') return fallback;
    return (options as readonly string[]).includes(value)
      ? (value as T)
      : new Error(`${name} must be one of: ${options.join(', ')}`);
  };
  const flag = (name: string) => {
    const value = query[name];
    if (value === undefined || value === '') return undefined;
    return value === 'true' || value === 'false'
      ? value === 'true'
      : new Error(`${name} must be true or false`);
  };

  const params = {
    q: text('q'),
    type: text('type'),
    place: text('place'),
    yearFrom: int('yearFrom', 0, 2100),
    yearTo: int('yearTo', 0, 2100),
    hasImage: flag('hasImage'),
    mode: choice('mode', ['hybrid', 'keyword'] as const, 'hybrid'),
    page: int('page', 1, 100, 1),
    size: int('size', 1, 50, 20),
  };
  const error = Object.values(params).find((v) => v instanceof Error);
  if (error) return { ok: false, message: error.message };

  const valid = params as SearchParams;
  if (valid.yearFrom !== undefined && valid.yearTo !== undefined && valid.yearFrom > valid.yearTo) {
    return { ok: false, message: 'yearFrom must not be after yearTo' };
  }
  if (isHybrid(valid) && valid.page * valid.size > HYBRID_DEPTH) {
    return {
      ok: false,
      message: `Only the best ${HYBRID_DEPTH} matches can be paged through; narrow the search, or use mode=keyword`,
    };
  }
  return { ok: true, params: valid };
}

/**
 * Where to send the search. A hybrid search for a question uses the question pipeline
 * (weighted towards meaning); every other search uses the index's default pipeline.
 */
export function searchPath(params: Pick<SearchParams, 'q' | 'mode'>): string {
  const path = `/${OBJECTS_ALIAS}/_search`;
  return isHybrid(params) && looksLikeQuestion(params.q)
    ? `${path}?search_pipeline=${HYBRID_QUESTION_PIPELINE}`
    : path;
}

/** Hybrid needs words to embed: browsing (no `q`) and `mode=keyword` are keyword-only. */
export function isHybrid(params: Pick<SearchParams, 'q' | 'mode'>): boolean {
  return params.mode === 'hybrid' && Boolean(params.q);
}

/**
 * Builds the OpenSearch request body: relevance query, exact filters, facets and highlights.
 *
 * With `queryVector` (the embedded query), the relevance query is a hybrid of the keyword query
 * and the nearest neighbours by meaning. The index's search pipeline normalises and combines
 * the two scores, so "woomera" still ranks exact matches first, while a question or a typo
 * that matches no words still finds related objects.
 */
export function buildSearchBody(params: SearchParams, queryVector?: number[]) {
  const filter: object[] = [];
  if (params.type) filter.push({ term: { 'types.keyword': params.type } });
  if (params.place) filter.push({ term: { 'places.keyword': params.place } });
  if (params.yearFrom !== undefined || params.yearTo !== undefined) {
    // Overlap, not containment: an object made 1910-1925 matches a 1920-1930 filter.
    if (params.yearTo !== undefined) filter.push({ range: { yearStart: { lte: params.yearTo } } });
    if (params.yearFrom !== undefined) {
      filter.push({ range: { yearEnd: { gte: params.yearFrom } } });
    }
  }
  if (params.hasImage !== undefined) filter.push({ term: { hasImage: params.hasImage } });

  const must = params.q
    ? [
        {
          multi_match: {
            query: params.q,
            fields: SEARCH_FIELDS,
            type: 'best_fields',
            tie_breaker: 0.3,
            minimum_should_match: '2<75%',
            // A query of only stop words ("the", "a") has no terms left after analysis:
            // browse everything rather than return an empty page.
            zero_terms_query: 'all',
          },
        },
      ]
    : [{ match_all: {} }];

  return {
    from: (params.page - 1) * params.size,
    size: params.size,
    track_total_hits: 10_000,
    _source: RESULT_FIELDS,
    query: queryVector
      ? {
          hybrid: {
            // Constant across pages, so page 2 continues the same ranking as page 1.
            pagination_depth: HYBRID_DEPTH,
            queries: [
              { bool: { must, filter } },
              // The same filters inside the k-NN search, so it returns the nearest *matching*
              // neighbours rather than filtering afterwards and coming back short.
              {
                knn: {
                  embedding: {
                    vector: queryVector,
                    k: HYBRID_NEIGHBOURS,
                    filter: { bool: { filter } },
                  },
                },
              },
            ],
          },
        }
      : { bool: { must, filter } },
    highlight: {
      // Escape the document text, so only our <mark> tags are HTML (the snippet is rendered as HTML).
      encoder: 'html',
      pre_tags: ['<mark>'],
      post_tags: ['</mark>'],
      fields: { physicalDescription: { fragment_size: 160, number_of_fragments: 1 } },
    },
    aggs: {
      // In a hybrid search the total includes neighbours that share no words with the query:
      // this counts the ones that do.
      ...(queryVector && { keywordMatches: { filter: { bool: { must } } } }),
      types: { terms: { field: 'types.keyword', size: 15 } },
      places: { terms: { field: 'places.keyword', size: 15 } },
      dated: { filter: { exists: { field: 'yearStart' } } },
      decades: { histogram: { field: 'yearStart', interval: 10, min_doc_count: 1 } },
    },
  };
}

interface Hit {
  _source: Partial<{
    id: string;
    title: string;
    types: string[];
    collection: string;
    places: string[];
    dateLabel: string;
    yearStart: number;
    yearEnd: number;
    images: {
      thumbnailUrl?: string;
      previewUrl?: string;
      rightsTitle: string;
      rightsUrl?: string;
    }[];
    sourceUrl: string;
    retrievedAt: string;
  }>;
  highlight?: Record<string, string[]>;
}

interface Bucket<K> {
  key: K;
  doc_count: number;
}

export interface OpenSearchSearchBody {
  hits: { total: { value: number } | number; hits: Hit[] };
  aggregations?: {
    types?: { buckets: Bucket<string>[] };
    places?: { buckets: Bucket<string>[] };
    dated?: { doc_count: number };
    keywordMatches?: { doc_count: number };
    decades?: { buckets: Bucket<number>[] };
  };
}

/** Maps the OpenSearch response to the API contract (SearchResponse in openapi.yaml). */
export function toSearchResponse(body: OpenSearchSearchBody, params: SearchParams): SearchResponse {
  const aggs = body.aggregations ?? {};
  const total = typeof body.hits.total === 'number' ? body.hits.total : body.hits.total.value;
  const facet = (buckets: Bucket<string>[] = []) =>
    buckets.map((b) => ({ value: b.key, count: b.doc_count }));

  return {
    total,
    keywordTotal: aggs.keywordMatches?.doc_count ?? total,
    mode: aggs.keywordMatches ? 'hybrid' : 'keyword',
    page: params.page,
    size: params.size,
    results: body.hits.hits.map(toResult),
    facets: {
      types: facet(aggs.types?.buckets),
      places: facet(aggs.places?.buckets),
      decades: (aggs.decades?.buckets ?? []).map((b) => ({ decade: b.key, count: b.doc_count })),
      datedCount: aggs.dated?.doc_count ?? 0,
    },
    attribution: ATTRIBUTION,
  };
}

function toResult({ _source: s, highlight }: Hit): SearchResult {
  const image = s.images?.find((i) => i.thumbnailUrl);
  return {
    id: s.id ?? '',
    title: s.title ?? '',
    types: s.types ?? [],
    collection: s.collection,
    places: s.places ?? [],
    dateLabel: s.dateLabel,
    yearStart: s.yearStart,
    yearEnd: s.yearEnd,
    thumbnail: image?.thumbnailUrl
      ? {
          url: image.thumbnailUrl,
          previewUrl: image.previewUrl,
          rightsTitle: image.rightsTitle,
          rightsUrl: image.rightsUrl,
        }
      : undefined,
    highlight: highlight?.physicalDescription?.[0],
    sourceUrl: s.sourceUrl ?? '',
    retrievedAt: s.retrievedAt ?? '',
  };
}
