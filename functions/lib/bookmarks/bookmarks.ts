import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { components } from '../api/types.gen.js';

export type Bookmark = components['schemas']['Bookmark'];

/** Where bookmarks live. One partition per user (their Cognito `sub`), one item per object. */
export interface BookmarksStore {
  list(sub: string): Promise<Bookmark[]>;
  put(sub: string, bookmark: Bookmark): Promise<void>;
  remove(sub: string, objectId: string): Promise<void>;
}

const OBJECT_ID = /^[0-9]{1,12}$/;

/**
 * GET /bookmarks, PUT and DELETE /bookmarks/{objectId}.
 *
 * The user comes only from the token claims API Gateway has already verified, never from the
 * path, query or body, so one user can't read or change another's bookmarks.
 */
export async function handleBookmarks(
  event: APIGatewayProxyEvent,
  store: BookmarksStore,
  now = () => new Date(),
): Promise<APIGatewayProxyResult> {
  const sub = event.requestContext?.authorizer?.claims?.sub;
  if (typeof sub !== 'string' || !sub) return json(401, { message: 'Unauthorized' });

  const route = `${event.httpMethod} ${event.resource}`;
  if (route === 'GET /bookmarks') {
    const bookmarks = await store.list(sub);
    bookmarks.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    return json(200, { bookmarks });
  }

  const objectId = event.pathParameters?.objectId ?? '';
  if (!OBJECT_ID.test(objectId)) return json(400, { message: 'objectId must be digits' });

  if (route === 'PUT /bookmarks/{objectId}') {
    const title = parseTitle(event.body);
    if (title === undefined) return json(400, { message: 'Body must be {"title": "..."}' });
    const bookmark = { objectId, title, addedAt: now().toISOString() };
    await store.put(sub, bookmark);
    return json(200, bookmark);
  }
  if (route === 'DELETE /bookmarks/{objectId}') {
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
