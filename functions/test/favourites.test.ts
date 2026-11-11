import type { APIGatewayProxyEvent } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import {
  type Favourite,
  type FavouritesStore,
  handleFavourites,
} from '../lib/favourites/favourites.js';

/** In-memory store keyed like the table: (sub, objectId). */
function memoryStore() {
  const items = new Map<string, Favourite & { sub: string }>();
  const store: FavouritesStore = {
    async list(sub) {
      return [...items.values()]
        .filter((i) => i.sub === sub)
        .map(({ objectId, title, addedAt }) => ({ objectId, title, addedAt }));
    },
    async put(sub, f) {
      items.set(`${sub}|${f.objectId}`, { sub, ...f });
    },
    async remove(sub, objectId) {
      items.delete(`${sub}|${objectId}`);
    },
  };
  return { store, items };
}

const event = (
  method: string,
  resource: string,
  opts: { sub?: string; objectId?: string; body?: unknown } = {},
) =>
  ({
    httpMethod: method,
    resource,
    pathParameters: opts.objectId ? { objectId: opts.objectId } : null,
    body: opts.body === undefined ? null : JSON.stringify(opts.body),
    requestContext: {
      requestId: 'r',
      authorizer: opts.sub ? { claims: { sub: opts.sub } } : undefined,
    },
  }) as unknown as APIGatewayProxyEvent;

const at = (iso: string) => () => new Date(iso);

describe('handleFavourites', () => {
  it('adds, lists newest first and removes favourites for the signed-in user', async () => {
    const { store } = memoryStore();
    const put = (id: string, title: string, iso: string) =>
      handleFavourites(
        event('PUT', '/favourites/{objectId}', { sub: 'alice', objectId: id, body: { title } }),
        store,
        at(iso),
      );
    expect((await put('1', 'Firestick', '2026-11-01T00:00:00Z')).statusCode).toBe(200);
    await put('2', 'Woomera', '2026-11-02T00:00:00Z');

    const list = await handleFavourites(event('GET', '/favourites', { sub: 'alice' }), store);
    expect(JSON.parse(list.body).favourites.map((f: Favourite) => f.objectId)).toEqual(['2', '1']);

    const del = await handleFavourites(
      event('DELETE', '/favourites/{objectId}', { sub: 'alice', objectId: '1' }),
      store,
    );
    expect(del.statusCode).toBe(204);
    expect(await store.list('alice')).toHaveLength(1);
  });

  it("keeps users apart: the user comes only from the verified token's claims", async () => {
    const { store, items } = memoryStore();
    await store.put('alice', {
      objectId: '1',
      title: 'Firestick',
      addedAt: '2026-11-01T00:00:00Z',
    });

    // Bob can't see Alice's list, and a `sub` smuggled into the body is ignored.
    const bobs = await handleFavourites(event('GET', '/favourites', { sub: 'bob' }), store);
    expect(JSON.parse(bobs.body).favourites).toEqual([]);
    await handleFavourites(
      event('PUT', '/favourites/{objectId}', {
        sub: 'bob',
        objectId: '9',
        body: { title: 'x', sub: 'alice' },
      }),
      store,
    );
    expect(items.get('bob|9')?.sub).toBe('bob');
    expect(items.has('alice|9')).toBe(false);

    // Deleting "Alice's" object as Bob removes nothing of Alice's.
    await handleFavourites(
      event('DELETE', '/favourites/{objectId}', { sub: 'bob', objectId: '1' }),
      store,
    );
    expect(items.has('alice|1')).toBe(true);
  });

  it('refuses requests without verified claims (should never reach the Lambda)', async () => {
    const { store } = memoryStore();
    expect((await handleFavourites(event('GET', '/favourites'), store)).statusCode).toBe(401);
  });

  it('validates the object ID and title', async () => {
    const { store } = memoryStore();
    const put = (objectId: string, body: unknown) =>
      handleFavourites(
        event('PUT', '/favourites/{objectId}', { sub: 'alice', objectId, body }),
        store,
      );
    expect((await put('12a', { title: 'x' })).statusCode).toBe(400);
    expect((await put('12', { title: '   ' })).statusCode).toBe(400);
    expect((await put('12', { title: 'x'.repeat(301) })).statusCode).toBe(400);
    expect((await put('12', { title: '  Firestick ' })).body).toContain('"title":"Firestick"');
  });
});
