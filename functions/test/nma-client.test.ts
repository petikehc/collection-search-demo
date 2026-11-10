import { describe, expect, it } from 'vitest';
import { NmaApiError, NmaClient } from '../lib/nma/client.js';
import { evenlySpacedOffsets } from '../lib/nma/sample.js';

type Reply = { status?: number; headers?: Record<string, string>; body?: unknown } | Error;

/** A client wired to a fake clock and a scripted fetch, so no test waits in real time. */
function setup(replies: Reply[], options: { apiKey?: string; minIntervalMs?: number } = {}) {
  let clock = 0;
  const sleeps: number[] = [];
  const calls: { url: string; at: number; headers: Record<string, string> }[] = [];

  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, at: clock, headers: init?.headers as Record<string, string> });
    const reply = replies.shift() ?? { body: { data: [] } };
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body ?? { data: [] }), {
      status: reply.status ?? 200,
      headers: reply.headers,
    });
  }) as typeof globalThis.fetch;

  const client = new NmaClient({
    ...options,
    fetch,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    random: () => 0.5,
  });
  return { client, calls, sleeps };
}

describe('NmaClient', () => {
  it('spaces requests at least one second apart', async () => {
    const { client, calls } = setup([{}, {}, {}]);
    for (let i = 0; i < 3; i++) await client.getPage('object?text=*');
    expect(calls.map((c) => c.at)).toEqual([0, 1000, 2000]);
  });

  it('waits for ratelimit-reset when no requests remain in the window', async () => {
    const { client, calls } = setup([
      { headers: { 'ratelimit-remaining': '0', 'ratelimit-reset': '7' } },
      {},
    ]);
    await client.getPage('object');
    await client.getPage('object');
    expect(calls[1]?.at).toBe(7000);
  });

  it('retries a 429 after Retry-After', async () => {
    const { client, calls, sleeps } = setup([
      { status: 429, headers: { 'retry-after': '3' } },
      { body: { data: [{ id: '1' }] } },
    ]);
    const page = await client.getPage('object');
    expect(page.data).toEqual([{ id: '1' }]);
    expect(calls).toHaveLength(2);
    expect(sleeps).toContain(3000);
  });

  it('backs off exponentially on 5xx and network errors', async () => {
    const replies: Reply[] = [{ status: 503 }, new Error('ECONNRESET'), { status: 500 }, {}];
    const { client, sleeps } = setup(replies, { minIntervalMs: 0 });
    await client.getPage('object');
    // equal jitter with random()=0.5: 75% of 1s, 2s, 4s
    expect(sleeps).toEqual([750, 1500, 3000]);
  });

  it('gives up after maxRetries', async () => {
    const { client, calls } = setup(Array(10).fill({ status: 502 }));
    await expect(client.getPage('object')).rejects.toMatchObject({ status: 502 });
    expect(calls).toHaveLength(6); // first try + 5 retries
  });

  it('does not retry other 4xx errors', async () => {
    const { client, calls } = setup([{ status: 400 }]);
    await expect(client.getPage('object')).rejects.toBeInstanceOf(NmaApiError);
    expect(calls).toHaveLength(1);
  });

  it('resolves relative links against the base URL and sends the API key when set', async () => {
    const { client, calls } = setup([{}], { apiKey: 'test-key' });
    await client.getPage('object?text=boomerang&limit=2&offset=2');
    expect(calls[0]?.url).toBe('https://data.nma.gov.au/object?text=boomerang&limit=2&offset=2');
    expect(calls[0]?.headers.apikey).toBe('test-key');
  });

  it('follows links.next when paginating', async () => {
    const { client, calls } = setup([
      { body: { data: [{ id: '1' }], links: { next: 'object?offset=1' } } },
      { body: { data: [{ id: '2' }] } },
    ]);
    const ids: string[] = [];
    for await (const page of client.paginate('object')) ids.push(...page.data.map((o) => o.id));
    expect(ids).toEqual(['1', '2']);
    expect(calls[1]?.url).toBe('https://data.nma.gov.au/object?offset=1');
  });

  it('returns null for a withdrawn object (410)', async () => {
    const { client } = setup([{ status: 410 }]);
    expect(await client.getObject('123')).toBeNull();
  });

  it('reads the total from the result-count header when meta is missing', async () => {
    const { client } = setup([{ headers: { 'result-count': '97214' }, body: { data: [] } }]);
    expect((await client.getPage('object')).meta?.results).toBe(97214);
  });
});

describe('evenlySpacedOffsets', () => {
  it('spreads page-aligned offsets over the whole result set', () => {
    expect(evenlySpacedOffsets(1000, 3, 100)).toEqual([0, 500, 900]);
  });

  it('never asks for more pages than exist', () => {
    expect(evenlySpacedOffsets(250, 10, 100)).toEqual([0, 100, 200]);
  });

  it('handles empty and tiny result sets', () => {
    expect(evenlySpacedOffsets(0, 5, 100)).toEqual([]);
    expect(evenlySpacedOffsets(30, 5, 100)).toEqual([0]);
  });
});
