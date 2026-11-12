import { describe, expect, it } from 'vitest';
import { clientKey, RateLimiter } from '../src/lib/rate-limit.js';

describe('RateLimiter', () => {
  it('allows up to the limit in a window, then says how long to wait', () => {
    let now = 0;
    const limiter = new RateLimiter(3, 60_000, () => now);
    expect([1, 2, 3].map(() => limiter.hit('a').allowed)).toEqual([true, true, true]);
    now = 15_000;
    expect(limiter.hit('a')).toEqual({ allowed: false, retryAfter: 45 });
  });

  it('counts each address separately, and starts a new window after the last', () => {
    let now = 0;
    const limiter = new RateLimiter(1, 60_000, () => now);
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('b').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(false);
    now = 60_000;
    expect(limiter.hit('a').allowed).toBe(true);
  });

  it('keeps memory bounded however many addresses it sees', () => {
    let now = 0;
    const limiter = new RateLimiter(1, 60_000, () => now, 100);
    for (let i = 0; i < 1000; i++) limiter.hit(`ip-${i}`);
    now = 30_000;
    // Old addresses were forgotten to make room, so they count as new.
    expect(limiter.hit('ip-0').allowed).toBe(true);
    expect(
      (limiter as unknown as { windows: Map<string, unknown> }).windows.size,
    ).toBeLessThanOrEqual(100);
  });
});

describe('clientKey', () => {
  it("uses the gateway's source IP when the Web Adapter passes it", () => {
    const headers = new Headers({
      'x-amzn-request-context': JSON.stringify({ http: { sourceIp: '203.0.113.7' } }),
      'x-forwarded-for': '198.51.100.1, 203.0.113.7',
    });
    expect(clientKey(headers, '127.0.0.1')).toBe('203.0.113.7');
  });

  it('otherwise takes the last forwarded address: the first one is set by the client', () => {
    const spoofed = new Headers({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' });
    expect(clientKey(spoofed, undefined)).toBe('203.0.113.7');
  });

  it('falls back to the connection address', () => {
    expect(clientKey(new Headers(), '127.0.0.1')).toBe('127.0.0.1');
  });
});
