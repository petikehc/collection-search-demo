import type { Client } from '@opensearch-project/opensearch';
import { describe, expect, it } from 'vitest';
import type { CollectionObject } from '../lib/nma/normalise.js';
import { readObjects, reindex, toSearchDocument } from '../lib/search/reindex.js';

const doc = toSearchDocument({
  id: '1',
  title: 'Boomerang',
  types: [],
  materials: [],
  places: [],
  creators: [],
  images: [],
  sourceUrl: 'https://example.org/1',
  retrievedAt: '2026-11-11T00:00:00.000Z',
} satisfies CollectionObject);

const NOW = new Date('2026-11-11T00:00:00Z');
const NEW_INDEX = 'objects-20261111000000';

/** Records calls; `fail` makes the named method throw. */
function fakeClient(opts: { aliasOn?: string[]; fail?: string } = {}) {
  const calls: { method: string; params: unknown }[] = [];
  const call = (method: string, result: unknown) => async (params: unknown) => {
    calls.push({ method, params });
    if (opts.fail === method) throw new Error(`${method} failed`);
    return { body: result };
  };
  const aliasOn = opts.aliasOn ?? [];
  const client = {
    bulk: call('bulk', { errors: false, items: [] }),
    count: call('count', { count: 1 }),
    indices: {
      create: call('create', {}),
      refresh: call('refresh', {}),
      existsAlias: call('existsAlias', aliasOn.length > 0),
      getAlias: call('getAlias', Object.fromEntries(aliasOn.map((i) => [i, {}]))),
      updateAliases: call('updateAliases', {}),
      get: call('get', Object.fromEntries([...aliasOn, NEW_INDEX].map((i) => [i, {}]))),
      delete: call('delete', {}),
    },
  };
  return { client: client as unknown as Client, calls };
}

describe('reindex', () => {
  it('scopes alias lookups to the versioned indices (least-privilege roles)', async () => {
    const { client, calls } = fakeClient({ aliasOn: ['objects-20261110000000'] });
    await reindex(client, [doc], { now: NOW });
    for (const method of ['existsAlias', 'getAlias']) {
      expect(calls.find((c) => c.method === method)?.params).toEqual({
        index: 'objects-*',
        name: 'objects',
      });
    }
  });

  it('deletes the new index if the alias swap fails, so nothing is orphaned', async () => {
    const { client, calls } = fakeClient({ fail: 'updateAliases' });
    await expect(reindex(client, [doc], { now: NOW })).rejects.toThrow('updateAliases failed');
    expect(calls.at(-1)).toEqual({ method: 'delete', params: { index: NEW_INDEX } });
  });

  it('never deletes the live index when pruning fails after the swap', async () => {
    const { client, calls } = fakeClient({ fail: 'get' });
    await expect(reindex(client, [doc], { now: NOW })).rejects.toThrow('get failed');
    expect(calls.some((c) => c.method === 'delete')).toBe(false);
  });
});

describe('readObjects', () => {
  it('reads one index page by page, in ID order, without the derived fields', async () => {
    const requests: { index: string; body: { from: number; size: number } }[] = [];
    const pages = [
      Array.from({ length: 1000 }, (_, i) => ({ _source: { id: String(i) } })),
      [{ _source: { id: 'last' } }],
    ];
    const client = {
      search: async (params: (typeof requests)[number]) => {
        requests.push(params);
        return { body: { hits: { hits: pages[requests.length - 1] ?? [] } } };
      },
    } as unknown as Client;

    const objects = await readObjects(client, 'objects-20261110235504');
    expect(objects).toHaveLength(1001);
    expect(objects.at(-1)).toEqual({ id: 'last' });
    expect(requests.map((r) => [r.index, r.body.from])).toEqual([
      ['objects-20261110235504', 0],
      ['objects-20261110235504', 1000],
    ]);
    expect(requests[0]?.body).toMatchObject({
      sort: [{ id: 'asc' }],
      _source: { excludes: ['embedding', 'hasImage'] },
    });
  });
});
