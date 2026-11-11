import { describe, expect, it } from 'vitest';
import type { CollectionObject } from '../lib/nma/normalise.js';
import objectsIndex from '../lib/search/objects-index.json' with { type: 'json' };
import {
  aliasSwapActions,
  bulkBody,
  indicesToPrune,
  newIndexName,
  toSearchDocument,
} from '../lib/search/reindex.js';

const obj: CollectionObject = {
  id: '1',
  title: 'Boomerang',
  types: ['Boomerangs'],
  materials: [],
  places: [],
  creators: [],
  images: [{ thumbnailUrl: 'https://example.org/t.jpg', rightsTitle: 'CC BY-SA 4.0' }],
  sourceUrl: 'https://example.org/1',
  retrievedAt: '2026-11-11T00:00:00.000Z',
};

describe('reindex helpers', () => {
  it('names indices by UTC timestamp so they sort by age', () => {
    expect(newIndexName('objects', new Date('2026-11-11T09:30:05.123Z'))).toBe(
      'objects-20261111093005',
    );
  });

  it('swaps the alias in one request, removing every old target', () => {
    expect(aliasSwapActions('objects', ['objects-1', 'objects-2'], 'objects-3')).toEqual([
      { remove: { index: 'objects-1', alias: 'objects' } },
      { remove: { index: 'objects-2', alias: 'objects' } },
      { add: { index: 'objects-3', alias: 'objects', is_write_index: true } },
    ]);
  });

  it('adds the alias when no index had it yet (first ingest)', () => {
    expect(aliasSwapActions('objects', [], 'objects-1')).toEqual([
      { add: { index: 'objects-1', alias: 'objects', is_write_index: true } },
    ]);
  });

  it('prunes all but the live index and the newest previous one', () => {
    const all = ['objects-20261101', 'objects-20261105', 'objects-20261110', 'objects-20261111'];
    expect(indicesToPrune('objects', all, 'objects-20261111', 1)).toEqual([
      'objects-20261105',
      'objects-20261101',
    ]);
  });

  it('never prunes indices that belong to something else', () => {
    expect(
      indicesToPrune('objects', ['kb-objects', 'objects-1', 'objects-2'], 'objects-2', 0),
    ).toEqual(['objects-1']);
  });

  it('builds bulk action/document pairs keyed by object id', () => {
    const doc = toSearchDocument(obj);
    expect(doc.hasImage).toBe(true);
    expect(bulkBody('objects-1', [doc])).toEqual([
      { index: { _index: 'objects-1', _id: '1' } },
      doc,
    ]);
  });
});

describe('objects index definition', () => {
  const mapped = Object.keys(objectsIndex.mappings.properties).sort();

  it('maps every field of a search document (the mapping is strict)', () => {
    const full: Required<CollectionObject> = {
      ...obj,
      collection: '',
      accessionNumber: '',
      yearStart: 0,
      yearEnd: 0,
      dateLabel: '',
      physicalDescription: '',
      contentDescription: '',
      description: '',
      significanceStatement: '',
      modified: '',
      licence: '',
    };
    expect(Object.keys(toSearchDocument(full, [0])).sort()).toEqual(mapped);
  });

  it('applies synonyms at search time only', () => {
    const { analyzer } = objectsIndex.settings.analysis;
    expect(analyzer.collection_text.filter).not.toContain('collection_synonyms');
    expect(analyzer.collection_search.filter).toContain('collection_synonyms');
  });
});
