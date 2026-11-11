/**
 * Calls our API from the server. Types come from openapi.yaml (generated), the same contract the
 * Lambdas are built against. The API key is added here and never reaches the browser.
 */
import type { components, operations } from '../../../functions/lib/api/types.gen.js';
import { getConfig } from './config.js';

export type SearchResponse = components['schemas']['SearchResponse'];
export type SearchParams = NonNullable<operations['searchObjects']['parameters']['query']>;
export type AskResponse = components['schemas']['AskResponse'];
export type Favourite = components['schemas']['Favourite'];

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function search(params: SearchParams): Promise<SearchResponse> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  return call<SearchResponse>('GET', `search?${query}`);
}

export function ask(accessToken: string, question: string): Promise<AskResponse> {
  return call<AskResponse>('POST', 'ask', { accessToken, body: { question } });
}

export async function listFavourites(accessToken: string): Promise<Favourite[]> {
  const res = await call<{ favourites: Favourite[] }>('GET', 'favourites', { accessToken });
  return res.favourites;
}

export function addFavourite(accessToken: string, objectId: string, title: string) {
  return call<Favourite>('PUT', `favourites/${encodeURIComponent(objectId)}`, {
    accessToken,
    body: { title },
  });
}

export function removeFavourite(accessToken: string, objectId: string) {
  return call<void>('DELETE', `favourites/${encodeURIComponent(objectId)}`, { accessToken });
}

async function call<T>(
  method: string,
  path: string,
  opts: { accessToken?: string; body?: unknown } = {},
): Promise<T> {
  const { apiUrl, apiKey } = await getConfig();
  const headers: Record<string, string> = { 'x-api-key': apiKey };
  if (opts.accessToken) headers.authorization = `Bearer ${opts.accessToken}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(new URL(path, apiUrl), {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new ApiError(res.status, json.message ?? `API returned ${res.status}`);
  return json as T;
}
