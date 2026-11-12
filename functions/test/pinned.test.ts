import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { NmaClient } from '../lib/nma/client.js';
import { fetchMissingPinned, PINNED_OBJECT_IDS } from '../lib/nma/pinned.js';
import pinned from '../lib/nma/pinned-objects.json' with { type: 'json' };

describe('pinned objects', () => {
  it('cover exactly the objects the eval set expects (run `pnpm pin:objects` if not)', () => {
    const expected = new Set<string>();
    const questions = readFileSync(new URL('../../evals/questions.jsonl', import.meta.url), 'utf8');
    for (const line of questions.split('\n')) {
      if (line.trim()) for (const id of JSON.parse(line).expectedObjectIds ?? []) expected.add(id);
    }
    expect(new Set(pinned.eval)).toEqual(expected);
  });

  it('are object IDs only, without duplicates', () => {
    expect(PINNED_OBJECT_IDS.every((id) => /^[0-9]{1,12}$/.test(id))).toBe(true);
    expect(new Set(PINNED_OBJECT_IDS).size).toBe(PINNED_OBJECT_IDS.length);
  });
});

describe('fetchMissingPinned', () => {
  it('fetches only what the sample lacks, one at a time, and skips withdrawn objects', async () => {
    const asked: string[] = [];
    const client = {
      getObject: async (id: string) => {
        asked.push(id);
        return { object: id === '3' ? null : { id }, maxAgeSeconds: 0 };
      },
    } as unknown as NmaClient;

    const result = await fetchMissingPinned(client, new Set(['1']), ['1', '2', '3']);
    expect(asked).toEqual(['2', '3']);
    expect(result.objects.map((o) => o.id)).toEqual(['2']);
    expect(result.withdrawn).toEqual(['3']);
  });
});
