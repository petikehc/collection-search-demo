import { describe, expect, it } from 'vitest';
import { HYBRID_DEPTH, HYBRID_NEIGHBOURS } from '../lib/search/constants.js';
import {
  buildSearchBody,
  isHybrid,
  type OpenSearchSearchBody,
  parseSearchParams,
  type SearchParams,
  searchPath,
  toSearchResponse,
} from '../lib/search/query.js';

const defaults: SearchParams = { mode: 'hybrid', page: 1, size: 20 };

type Bool = { must: object[]; filter: object[] };
/** The keyword query of a body built without a query vector. */
const keywordQuery = (body: ReturnType<typeof buildSearchBody>) =>
  (body.query as { bool: Bool }).bool;

describe('parseSearchParams', () => {
  it('applies defaults and trims text', () => {
    expect(parseSearchParams({ q: '  boomerang ' })).toEqual({
      ok: true,
      params: { q: 'boomerang', mode: 'hybrid', page: 1, size: 20 },
    });
    expect(parseSearchParams(null)).toEqual({ ok: true, params: defaults });
  });

  it.each([
    [{ page: '0' }, 'page must be an integer from 1 to 100'],
    [{ size: '51' }, 'size must be an integer from 1 to 50'],
    [{ size: '2.5' }, 'size must be an integer from 1 to 50'],
    [{ yearFrom: 'abc' }, 'yearFrom must be an integer from 0 to 2100'],
    [{ q: 'x'.repeat(201) }, 'q must be at most 200 characters'],
    [{ yearFrom: '1950', yearTo: '1900' }, 'yearFrom must not be after yearTo'],
    [{ mode: 'vector' }, 'mode must be one of: hybrid, keyword'],
    [{ hasImage: 'yes' }, 'hasImage must be true or false'],
  ])('rejects %j', (query, message) => {
    expect(parseSearchParams(query)).toEqual({ ok: false, message });
  });

  it('reads the image filter and the mode', () => {
    expect(parseSearchParams({ hasImage: 'true', mode: 'keyword' })).toMatchObject({
      params: { hasImage: true, mode: 'keyword' },
    });
  });

  it('only pages through the best matches of a hybrid search', () => {
    const beyond = { q: 'photo', page: String(HYBRID_DEPTH / 20 + 1), size: '20' };
    expect(parseSearchParams(beyond)).toMatchObject({ ok: false });
    // The same page is fine for keyword search, and for browsing, which is never hybrid.
    expect(parseSearchParams({ ...beyond, mode: 'keyword' })).toMatchObject({ ok: true });
    expect(parseSearchParams({ page: beyond.page })).toMatchObject({ ok: true });
  });
});

describe('searchPath', () => {
  it('ranks questions by meaning, through the question pipeline', () => {
    expect(searchPath({ q: 'What did people use to start fires?', mode: 'hybrid' })).toBe(
      '/objects/_search?search_pipeline=objects-hybrid-question',
    );
  });

  it("uses the index's default pipeline for keywords, browsing and keyword mode", () => {
    expect(searchPath({ q: 'woomera', mode: 'hybrid' })).toBe('/objects/_search');
    expect(searchPath({ mode: 'hybrid' })).toBe('/objects/_search');
    expect(searchPath({ q: 'What is a woomera?', mode: 'keyword' })).toBe('/objects/_search');
  });
});

describe('isHybrid', () => {
  it('needs words to embed, and hybrid mode', () => {
    expect(isHybrid({ q: 'woomera', mode: 'hybrid' })).toBe(true);
    expect(isHybrid({ mode: 'hybrid' })).toBe(false);
    expect(isHybrid({ q: 'woomera', mode: 'keyword' })).toBe(false);
  });
});

describe('buildSearchBody', () => {
  it('matches everything when there is no query', () => {
    expect(keywordQuery(buildSearchBody(defaults)).must).toEqual([{ match_all: {} }]);
  });

  it('searches boosted fields for free text', () => {
    const body = buildSearchBody({ ...defaults, q: 'woomera' });
    expect(keywordQuery(body).must[0]).toMatchObject({
      multi_match: { query: 'woomera', fields: expect.arrayContaining(['title^4']) },
    });
  });

  it('lets the words match in different fields ("church" in the title, "Victoria" in the place)', () => {
    const body = buildSearchBody({ ...defaults, q: 'churches in victoria' });
    expect(keywordQuery(body).must[0]).toMatchObject({ multi_match: { type: 'cross_fields' } });
  });

  it('includes the accession number, so staff can look an object up by its number', () => {
    const body = buildSearchBody({ ...defaults, q: '2016.0013.0001' });
    expect(keywordQuery(body).must[0]).toMatchObject({
      multi_match: { fields: expect.arrayContaining(['accessionNumber^10']) },
    });
  });

  it('browses everything when the query is only stop words', () => {
    const body = buildSearchBody({ ...defaults, q: 'the' });
    expect(keywordQuery(body).must[0]).toMatchObject({ multi_match: { zero_terms_query: 'all' } });
  });

  it('filters on exact facet values', () => {
    const body = buildSearchBody({ ...defaults, type: 'Boomerangs', place: 'Victoria, Australia' });
    expect(keywordQuery(body).filter).toEqual([
      { term: { 'types.keyword': 'Boomerangs' } },
      { term: { 'places.keyword': 'Victoria, Australia' } },
    ]);
  });

  it('matches date ranges that overlap the filter', () => {
    const body = buildSearchBody({ ...defaults, yearFrom: 1920, yearTo: 1930 });
    expect(keywordQuery(body).filter).toEqual([
      { range: { yearStart: { lte: 1930 } } },
      { range: { yearEnd: { gte: 1920 } } },
    ]);
  });

  it('pages with from/size', () => {
    expect(buildSearchBody({ ...defaults, page: 3, size: 10 })).toMatchObject({
      from: 20,
      size: 10,
    });
  });

  it('filters on whether the Museum has an image', () => {
    const body = buildSearchBody({ ...defaults, hasImage: true });
    expect(keywordQuery(body).filter).toEqual([{ term: { hasImage: true } }]);
  });

  it('escapes document text in highlights', () => {
    expect(buildSearchBody(defaults).highlight.encoder).toBe('html');
  });
});

describe('buildSearchBody with a query vector (hybrid)', () => {
  const vector = [0.1, 0.2, 0.3];
  const params: SearchParams = { ...defaults, q: 'woomera', type: 'Spearthrowers' };
  const body = buildSearchBody(params, vector);
  const { hybrid } = body.query as {
    hybrid: { pagination_depth: number; queries: [{ bool: Bool }, { knn: { embedding: object } }] };
  };

  it('ranks the keyword query together with the nearest neighbours', () => {
    expect(hybrid.queries[0].bool.must[0]).toMatchObject({ multi_match: { query: 'woomera' } });
    expect(hybrid.queries[1].knn.embedding).toMatchObject({ vector, k: HYBRID_NEIGHBOURS });
  });

  it('applies the same filters to both halves', () => {
    const filter = [{ term: { 'types.keyword': 'Spearthrowers' } }];
    expect(hybrid.queries[0].bool.filter).toEqual(filter);
    expect(hybrid.queries[1].knn.embedding).toMatchObject({ filter: { bool: { filter } } });
  });

  it('keeps the ranking depth constant, so pages continue one ranking', () => {
    expect(hybrid.pagination_depth).toBe(HYBRID_DEPTH);
    const page2 = buildSearchBody({ ...params, page: 2 }, vector);
    expect(page2.from).toBe(20);
    expect((page2.query as typeof body.query & { hybrid: object }).hybrid).toEqual(hybrid);
  });

  it('counts how many results match the words, apart from the neighbours', () => {
    expect(body.aggs).toMatchObject({
      keywordMatches: { filter: { bool: { must: hybrid.queries[0].bool.must } } },
    });
    expect(buildSearchBody(params).aggs).not.toHaveProperty('keywordMatches');
  });
});

describe('toSearchResponse', () => {
  const body: OpenSearchSearchBody = {
    hits: {
      total: { value: 1 },
      hits: [
        {
          _source: {
            id: '1',
            title: 'Boomerang',
            types: ['Boomerangs'],
            places: [],
            images: [
              {
                rightsTitle: 'CC BY-SA 4.0',
                thumbnailUrl: 'https://example.org/t.jpg',
                previewUrl: 'https://example.org/w.jpg',
              },
            ],
            sourceUrl: 'https://example.org/1',
            retrievedAt: '2026-11-11T00:00:00.000Z',
          },
          highlight: { physicalDescription: ['carved <mark>boomerang</mark>'] },
        },
      ],
    },
    aggregations: {
      types: { buckets: [{ key: 'Boomerangs', doc_count: 1 }] },
      places: { buckets: [] },
      dated: { doc_count: 0 },
      decades: { buckets: [{ key: 1910, doc_count: 1 }] },
    },
  };

  it('maps hits, thumbnail, highlight and facets to the API contract', () => {
    const res = toSearchResponse(body, defaults);
    expect(res).toMatchObject({ total: 1, keywordTotal: 1, mode: 'keyword' });
    expect(res.results[0]).toMatchObject({
      id: '1',
      thumbnail: {
        url: 'https://example.org/t.jpg',
        previewUrl: 'https://example.org/w.jpg',
        rightsTitle: 'CC BY-SA 4.0',
      },
      highlight: 'carved <mark>boomerang</mark>',
    });
    expect(res.facets).toEqual({
      types: [{ value: 'Boomerangs', count: 1 }],
      places: [],
      decades: [{ decade: 1910, count: 1 }],
      datedCount: 0,
    });
    expect(res.attribution).toMatch(/National Museum of Australia's Collection API/);
  });

  it('reports how many hybrid results match the words', () => {
    const hybrid = {
      ...body,
      hits: { ...body.hits, total: { value: 37 } },
      aggregations: { ...body.aggregations, keywordMatches: { doc_count: 15 } },
    };
    expect(toSearchResponse(hybrid, defaults)).toMatchObject({
      total: 37,
      keywordTotal: 15,
      mode: 'hybrid',
    });
  });
});
