import { describe, expect, it } from 'vitest';
import { normaliseObject, parseYear } from '../lib/nma/normalise.js';
import type { NmaObject } from '../lib/nma/types.js';
import fixture from './fixtures/nma-objects.json' with { type: 'json' };

const [fireLighter, tractor, noLink] = fixture.data as NmaObject[];
const retrievedAt = '2026-11-10T00:00:00.000Z';

describe('normaliseObject', () => {
  it('maps a full record', () => {
    expect(normaliseObject(fireLighter as NmaObject, retrievedAt)).toEqual({
      id: '30339',
      title: 'Fire lighter',
      types: ['Firebricks'],
      collection: 'Lyn Cousins and Chris Tyrell collection',
      accessionNumber: '1986.0107.0035',
      materials: ['Ceramic', 'Wire - non specific'],
      places: ['Eden, New South Wales, Australia', 'Burrogate, New South Wales, Australia'],
      creators: [],
      yearStart: 1926,
      yearEnd: 1983,
      dateLabel: '1926 - 1983',
      physicalDescription: expect.stringContaining('handmade brick'),
      contentDescription: undefined,
      description: undefined,
      significanceStatement: undefined,
      images: [
        {
          thumbnailUrl: expect.stringMatching(/_t\.jpg$/),
          previewUrl: expect.stringMatching(/_w\.jpg$/),
          rightsTitle: 'CC BY-NC-SA 4.0',
          rightsUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
        },
      ],
      sourceUrl: 'https://collectionsearch.nma.gov.au/s/hw/EMU.EMUIRN/30339',
      modified: '2026-06-12',
      licence: 'https://creativecommons.org/licenses/by-nc/4.0/',
      retrievedAt,
    });
  });

  it('cleans whitespace, skips nameless creators and media without image URLs', () => {
    const obj = normaliseObject(tractor as NmaObject, retrievedAt);
    expect(obj?.title).toBe('1912 McDonald EB Imperial tractor no.140 with crank handle');
    expect(obj?.creators).toEqual([]);
    expect(obj?.images).toEqual([]);
    expect(obj?.yearStart).toBeUndefined();
  });

  it('drops records without a link back to the Museum', () => {
    expect(normaliseObject(noLink as NmaObject, retrievedAt)).toBeNull();
  });
});

describe('parseYear', () => {
  it.each([
    ['1926', 1926],
    ['1926-05-12', 1926],
    ['c. 1880', 1880],
    ['unknown', undefined],
    [undefined, undefined],
  ])('%s → %s', (input, expected) => {
    expect(parseYear(input)).toBe(expected);
  });
});
