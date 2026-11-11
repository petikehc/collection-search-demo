import { describe, expect, it } from 'vitest';
import type { CollectionObject } from '../lib/nma/normalise.js';
import { EMBEDDING_DIMENSIONS, HYBRID_PIPELINE } from '../lib/search/constants.js';
import { embedAll, embeddingText } from '../lib/search/embed.js';
import objectsIndex from '../lib/search/objects-index.json' with { type: 'json' };
import { cached } from '../lib/search/query-vector.js';
import { toSearchDocument } from '../lib/search/reindex.js';

const object: CollectionObject = {
  id: '1',
  title: 'Spearthrower',
  types: ['Spearthrowers'],
  materials: ['Wood'],
  places: ['Gilgandra, New South Wales, Australia'],
  creators: [],
  images: [],
  dateLabel: '1900',
  physicalDescription: 'A wooden spearthrower in three parts.',
  significanceStatement: 'A statement shared by every object in the collection.',
  sourceUrl: 'https://example.org/1',
  retrievedAt: '2026-11-12T00:00:00.000Z',
};

describe('embeddingText', () => {
  it("describes the object itself, without the collection's shared statement", () => {
    const text = embeddingText(object);
    expect(text).toContain('Spearthrower\nSpearthrowers\nGilgandra');
    expect(text).toContain('A wooden spearthrower in three parts.');
    expect(text).not.toContain('shared by every object');
  });
});

describe('embedAll', () => {
  const noSleep = async () => undefined;

  it('returns vectors in input order, a few at a time', async () => {
    let running = 0;
    let peak = 0;
    const embed = async (text: string) => {
      peak = Math.max(peak, ++running);
      await new Promise((resolve) => setTimeout(resolve, 5 - Number(text)));
      running--;
      return [Number(text)];
    };
    const vectors = await embedAll(['0', '1', '2', '3', '4'], embed, { concurrency: 2 });
    expect(vectors).toEqual([[0], [1], [2], [3], [4]]);
    expect(peak).toBe(2);
  });

  it('retries a failed call', async () => {
    let calls = 0;
    const embed = async () => {
      if (++calls < 3) throw new Error('throttled');
      return [1];
    };
    expect(await embedAll(['a'], embed, { sleep: noSleep })).toEqual([[1]]);
    expect(calls).toBe(3);
  });

  it('fails the whole run if a text can never be embedded', async () => {
    const embed = async () => {
      throw new Error('throttled');
    };
    await expect(embedAll(['a'], embed, { retries: 2, sleep: noSleep })).rejects.toThrow(
      'throttled',
    );
  });
});

describe('cached', () => {
  it('embeds the same words once, forgets the oldest, and never caches a failure', async () => {
    const calls: string[] = [];
    let fail = false;
    const embed = cached(async (text) => {
      calls.push(text);
      if (fail) throw new Error('down');
      return [text.length];
    }, 2);

    await embed('a');
    await embed('a');
    expect(calls).toEqual(['a']);

    await embed('b');
    await embed('c'); // evicts 'a'
    await embed('a');
    expect(calls).toEqual(['a', 'b', 'c', 'a']);

    fail = true;
    await expect(embed('d')).rejects.toThrow('down');
    fail = false;
    expect(await embed('d')).toEqual([1]);
  });
});

describe('the objects index', () => {
  it('stores a vector the size the embedding model returns, for inner-product search', () => {
    expect(objectsIndex.settings.index.knn).toBe(true);
    expect(objectsIndex.mappings.properties.embedding).toMatchObject({
      type: 'knn_vector',
      dimension: EMBEDDING_DIMENSIONS,
      method: { engine: 'faiss', space_type: 'innerproduct' },
    });
  });

  it('runs searches through the hybrid pipeline the Search stack creates', () => {
    expect(objectsIndex.settings.index.search.default_pipeline).toBe(HYBRID_PIPELINE);
  });

  it('indexes an object with or without its vector', () => {
    expect(toSearchDocument(object, [0.5])).toMatchObject({ hasImage: false, embedding: [0.5] });
    expect(toSearchDocument(object)).not.toHaveProperty('embedding');
  });
});
