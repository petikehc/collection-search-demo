/**
 * Per-address request limits, kept in memory in each server instance. Up to five instances run
 * at once (the Lambda's reserved concurrency), so a determined client gets at most five times
 * these: they slow crawlers, they aren't a hard ceiling. The hard bounds are elsewhere: the
 * daily allowance of answers, the API quota and the gateway throttle (ADR 15).
 */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000,
  ) {}

  /** Counts one request. Returns the seconds to wait if the key is over its limit. */
  hit(key: string): { allowed: true } | { allowed: false; retryAfter: number } {
    const now = this.now();
    let window = this.windows.get(key);
    if (!window || now - window.start >= this.windowMs) {
      this.forgetOld(now);
      window = { start: now, count: 0 };
      this.windows.delete(key);
      this.windows.set(key, window);
    }
    window.count++;
    if (window.count <= this.limit) return { allowed: true };
    return { allowed: false, retryAfter: Math.ceil((window.start + this.windowMs - now) / 1000) };
  }

  /** Keeps memory bounded: expired windows go first, then the oldest if still too many. */
  private forgetOld(now: number) {
    if (this.windows.size < this.maxKeys) return;
    for (const [key, w] of this.windows) {
      if (now - w.start >= this.windowMs) this.windows.delete(key);
    }
    for (const key of this.windows.keys()) {
      if (this.windows.size < this.maxKeys) break;
      this.windows.delete(key);
    }
  }
}

/**
 * The client's address, from something the client can't set. Behind API Gateway, the Lambda
 * Web Adapter passes the gateway's request context (with the connection's source IP) in
 * `x-amzn-request-context`. Otherwise, the last X-Forwarded-For entry, which the nearest proxy
 * appended: the first one is whatever the client sent.
 */
export function clientKey(headers: Headers, fallback: string | undefined): string {
  try {
    const context = JSON.parse(headers.get('x-amzn-request-context') ?? '') as {
      http?: { sourceIp?: string };
    };
    if (context.http?.sourceIp) return context.http.sourceIp;
  } catch {
    // not behind API Gateway
  }
  const forwarded = headers
    .get('x-forwarded-for')
    ?.split(',')
    .map((s) => s.trim());
  return forwarded?.at(-1) || fallback || 'unknown';
}
