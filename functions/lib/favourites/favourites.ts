import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { components } from '../api/types.gen.js';

export type Favourite = components['schemas']['Favourite'];

/** Where favourites live. One partition per user (their Cognito `sub`), one item per object. */
export interface FavouritesStore {
  list(sub: string): Promise<Favourite[]>;
  put(sub: string, favourite: Favourite): Promise<void>;
  remove(sub: string, objectId: string): Promise<void>;
}

const OBJECT_ID = /^[0-9]{1,12}$/;

/**
 * GET /favourites, PUT and DELETE /favourites/{objectId}.
 *
 * The user comes only from the token claims API Gateway has already verified, never from the
 * path, query or body, so one user can't read or change another's favourites.
 */
export async function handleFavourites(
  event: APIGatewayProxyEvent,
  store: FavouritesStore,
  now = () => new Date(),
): Promise<APIGatewayProxyResult> {
  const sub = event.requestContext?.authorizer?.claims?.sub;
  if (typeof sub !== 'string' || !sub) return json(401, { message: 'Unauthorized' });

  const route = `${event.httpMethod} ${event.resource}`;
  if (route === 'GET /favourites') {
    const favourites = await store.list(sub);
    favourites.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    return json(200, { favourites });
  }

  const objectId = event.pathParameters?.objectId ?? '';
  if (!OBJECT_ID.test(objectId)) return json(400, { message: 'objectId must be digits' });

  if (route === 'PUT /favourites/{objectId}') {
    const title = parseTitle(event.body);
    if (title === undefined) return json(400, { message: 'Body must be {"title": "..."}' });
    const favourite = { objectId, title, addedAt: now().toISOString() };
    await store.put(sub, favourite);
    return json(200, favourite);
  }
  if (route === 'DELETE /favourites/{objectId}') {
    await store.remove(sub, objectId);
    return { statusCode: 204, headers: {}, body: '' };
  }
  return json(404, { message: 'Not found' });
}

export function parseTitle(body: string | null): string | undefined {
  try {
    const title = (JSON.parse(body ?? '') as { title?: unknown })?.title;
    if (typeof title !== 'string') return undefined;
    const trimmed = title.trim();
    return trimmed.length >= 1 && trimmed.length <= 300 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

function json(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}
