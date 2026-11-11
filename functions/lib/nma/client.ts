import type { NmaObject, NmaPage } from './types.js';

export const NMA_BASE_URL = 'https://data.nma.gov.au/';

export interface NmaClientOptions {
  baseUrl?: string;
  /** Optional key, sent as the `apikey` header. The API also works without one, at lower limits. */
  apiKey?: string;
  /** Minimum gap between requests. 1000 ms keeps us at the unauthenticated 60/minute limit. */
  minIntervalMs?: number;
  /** Retries for 429, 5xx and network errors before giving up. */
  maxRetries?: number;
  /**
   * Gives up on a request that takes longer than this, and doesn't retry it: a slow API won't
   * get faster by asking again. Unset (the ingest's default) means no limit.
   */
  timeoutMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

/** The `max-age` from a Cache-Control header, in seconds; 0 if absent or `no-store`/`no-cache`. */
export function maxAgeSeconds(cacheControl: string | null): number {
  if (!cacheControl || /no-store|no-cache/i.test(cacheControl)) return 0;
  const match = /max-age=(\d+)/i.exec(cacheControl);
  return match ? Number(match[1]) : 0;
}

export class NmaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'NmaApiError';
  }
}

const MAX_BACKOFF_MS = 30_000;

/**
 * Client for the Museum's Collection API, which is polite to the API by design:
 * - spaces requests out (one per `minIntervalMs`),
 * - pauses when the `ratelimit-remaining` header reaches 0, until `ratelimit-reset`,
 * - retries 429s (honouring `Retry-After`), 5xx and network errors with exponential backoff and jitter.
 */
export class NmaClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number | undefined;
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;
  private nextRequestAt = 0;

  constructor(options: NmaClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? NMA_BASE_URL;
    this.apiKey = options.apiKey;
    this.minIntervalMs = options.minIntervalMs ?? 1000;
    this.maxRetries = options.maxRetries ?? 5;
    this.timeoutMs = options.timeoutMs;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  /** Fetches one page. `path` can be relative, like the API's own `links.next` values. */
  async getPage<T = NmaObject>(path: string): Promise<NmaPage<T>> {
    const res = await this.request(path);
    const page = (await res.json()) as NmaPage<T>;
    const count = Number(res.headers.get('result-count'));
    if (page.meta?.results === undefined && Number.isFinite(count)) {
      page.meta = { ...page.meta, results: count };
    }
    return page;
  }

  /** Yields pages by following `links.next` until there are none or `maxPages` is reached. */
  async *paginate<T = NmaObject>(path: string, maxPages = Number.POSITIVE_INFINITY) {
    let next: string | undefined = path;
    for (let n = 0; next && n < maxPages; n++) {
      const page: NmaPage<T> = await this.getPage<T>(next);
      yield page;
      next = page.links?.next;
    }
  }

  /**
   * Fetches one object live. `object` is null when the Museum has withdrawn it (410) or it doesn't
   * exist. `maxAgeSeconds` is how long the Museum says the response may be cached (0 if it doesn't say).
   */
  async getObject(id: string): Promise<{ object: NmaObject | null; maxAgeSeconds: number }> {
    try {
      const res = await this.request(`object/${encodeURIComponent(id)}`);
      const page = (await res.json()) as NmaPage<NmaObject>;
      return {
        object: page.data[0] ?? null,
        maxAgeSeconds: maxAgeSeconds(res.headers.get('cache-control')),
      };
    } catch (err) {
      if (err instanceof NmaApiError && (err.status === 404 || err.status === 410)) {
        return { object: null, maxAgeSeconds: 0 };
      }
      throw err;
    }
  }

  private async request(path: string): Promise<Response> {
    const url = new URL(path, this.baseUrl).toString();
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': 'collection-search-demo (non-commercial learning project)',
    };
    if (this.apiKey) headers.apikey = this.apiKey;

    for (let attempt = 0; ; attempt++) {
      await this.waitForTurn();

      let res: Response;
      try {
        const signal = this.timeoutMs ? AbortSignal.timeout(this.timeoutMs) : undefined;
        res = await this.fetch(url, { headers, signal });
      } catch (err) {
        const timedOut = err instanceof Error && err.name === 'TimeoutError';
        if (timedOut || attempt >= this.maxRetries) throw err;
        await this.sleep(this.backoff(attempt));
        continue;
      }

      this.respectRateLimitHeaders(res.headers);
      if (res.ok) return res;

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= this.maxRetries) {
        throw new NmaApiError(`Collection API returned ${res.status} for ${url}`, res.status);
      }
      await this.sleep(this.retryDelay(res.headers, attempt));
    }
  }

  private async waitForTurn(): Promise<void> {
    const wait = this.nextRequestAt - this.now();
    if (wait > 0) await this.sleep(wait);
    this.nextRequestAt = this.now() + this.minIntervalMs;
  }

  /** When the API says no requests remain in the current window, hold off until it resets. */
  private respectRateLimitHeaders(headers: Headers): void {
    if (headers.get('ratelimit-remaining') !== '0') return;
    const resetMs = seconds(headers.get('ratelimit-reset')) ?? 1000;
    this.nextRequestAt = Math.max(this.nextRequestAt, this.now() + resetMs);
  }

  private retryDelay(headers: Headers, attempt: number): number {
    return (
      seconds(headers.get('retry-after')) ??
      seconds(headers.get('ratelimit-reset')) ??
      this.backoff(attempt)
    );
  }

  /** Exponential backoff with "equal jitter": half fixed, half random, capped at 30 s. */
  private backoff(attempt: number): number {
    const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
    return Math.round(base / 2 + (this.random() * base) / 2);
  }
}

function seconds(value: string | null): number | undefined {
  const n = Number(value);
  return value !== null && value !== '' && Number.isFinite(n) && n >= 0 ? n * 1000 : undefined;
}
