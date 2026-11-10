import { describe, expect, it } from 'vitest';
import {
  buildSearchBody,
  type OpenSearchSearchBody,
  parseSearchParams,
  type SearchParams,
  toSearchResponse,
} from '../lib/search/query.js';

const defaults: SearchParams = { page: 1, size: 20 };

describe('parseSearchParams', () => {
  it('applies defaults and trims text', () => {
    expect(parseSearchParams({ q: '  boomerang ' })).toEqual({
      ok: true,
      params: { q: 'boomerang', page: 1, size: 20 },
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
  ])('rejects %j', (query, message) => {
    expect(parseSearchParams(query)).toEqual({ ok: false, message });
  });
});

describe('buildSearchBody', () => {
  it('matches everything when there is no query', () => {
    expect(buildSearchBody(defaults).query.bool.must).toEqual([{ match_all: {} }]);
  });

  it('searches boosted fields for free text', () => {
    const body = buildSearchBody({ ...defaults, q: 'woomera' });
    expect(body.query.bool.must[0]).toMatchObject({
      multi_match: { query: 'woomera', fields: expect.arrayContaining(['title^4']) },
    });
  });

  it('browses everything when the query is only stop words', () => {
    const body = buildSearchBody({ ...defaults, q: 'the' });
    expect(body.query.bool.must[0]).toMatchObject({ multi_match: { zero_terms_query: 'all' } });
  });

  it('filters on exact facet values', () => {
    const body = buildSearchBody({ ...defaults, type: 'Boomerangs', place: 'Victoria, Australia' });
    expect(body.query.bool.filter).toEqual([
      { term: { 'types.keyword': 'Boomerangs' } },
      { term: { 'places.keyword': 'Victoria, Australia' } },
    ]);
  });

  it('matches date ranges that overlap the filter', () => {
    const body = buildSearchBody({ ...defaults, yearFrom: 1920, yearTo: 1930 });
    expect(body.query.bool.filter).toEqual([
      { range: { yearStart: { lte: 1930 } } },
      { range: { yearEnd: { gte: 1920 } } },
    ]);
  });

  it('pages with from/size', () => {
    expect(buildSearchBody({ page: 3, size: 10 })).toMatchObject({ from: 20, size: 10 });
  });

  it('escapes document text in highlights', () => {
    expect(buildSearchBody(defaults).highlight.encoder).toBe('html');
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
            images: [{ rightsTitle: 'CC BY-SA 4.0', thumbnailUrl: 'https://example.org/t.jpg' }],
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
    expect(res.total).toBe(1);
    expect(res.results[0]).toMatchObject({
      id: '1',
      thumbnail: { url: 'https://example.org/t.jpg', rightsTitle: 'CC BY-SA 4.0' },
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
});
