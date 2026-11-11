import { describe, expect, it } from 'vitest';
import { planSync, toKbFiles } from '../lib/kb/documents.js';
import type { CollectionObject } from '../lib/nma/normalise.js';

const obj: CollectionObject = {
  id: '30339',
  title: 'Fire lighter',
  types: ['Firebricks'],
  collection: 'Lyn Cousins and Chris Tyrell collection',
  materials: ['Ceramic'],
  places: ['Eden, New South Wales, Australia'],
  creators: [],
  yearStart: 1926,
  dateLabel: '1926 - 1983',
  physicalDescription: 'A squarish piece of handmade brick bound with wire.',
  significanceStatement: 'A collection of domestic objects.',
  images: [{ thumbnailUrl: 'https://example.org/t.jpg', rightsTitle: 'CC BY-NC-SA 4.0' }],
  sourceUrl: 'https://collectionsearch.nma.gov.au/s/hw/EMU.EMUIRN/30339',
  retrievedAt: '2026-11-11T00:00:00.000Z',
};

describe('toKbFiles', () => {
  const [markdown, metadata] = toKbFiles(obj);

  it('writes a Markdown document with the facts, descriptions and a credited link back', () => {
    expect(markdown?.key).toBe('kb/30339.md');
    expect(markdown?.body).toContain('# Fire lighter');
    expect(markdown?.body).toContain('- Places: Eden, New South Wales, Australia');
    expect(markdown?.body).toContain('handmade brick');
    expect(markdown?.body).toContain('## About the collection this object belongs to');
    expect(markdown?.body).toContain(`National Museum of Australia, ${obj.sourceUrl}`);
  });

  it('writes the metadata sidecar Bedrock returns with each citation', () => {
    expect(metadata?.key).toBe('kb/30339.md.metadata.json');
    expect(JSON.parse(metadata?.body ?? '')).toEqual({
      metadataAttributes: {
        objectId: '30339',
        title: 'Fire lighter',
        sourceUrl: obj.sourceUrl,
        hasImage: true,
        type: 'Firebricks',
        yearStart: 1926,
      },
    });
  });

  it('is stable across runs: retrievedAt changes do not change the files', () => {
    const later = toKbFiles({ ...obj, retrievedAt: '2026-12-01T00:00:00.000Z' });
    expect(later.map((f) => f.md5)).toEqual([markdown?.md5, metadata?.md5]);
  });
});

describe('planSync', () => {
  const files = toKbFiles(obj);

  it('uploads new and changed files, deletes ones no longer wanted, skips unchanged', () => {
    const existing = new Map([
      ['kb/30339.md', files[0]?.md5 ?? ''],
      ['kb/30339.md.metadata.json', 'stale-etag'],
      ['kb/99999.md', 'x'],
    ]);
    const plan = planSync(existing, files);
    expect(plan.put.map((f) => f.key)).toEqual(['kb/30339.md.metadata.json']);
    expect(plan.remove).toEqual(['kb/99999.md']);
    expect(plan.unchanged).toBe(1);
  });
});
