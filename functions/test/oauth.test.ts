import { describe, expect, it, vi } from 'vitest';
import {
  authorizeUrl,
  challengeFor,
  createPkce,
  createState,
  exchangeCode,
} from '../lib/auth/oauth.js';

describe('PKCE', () => {
  it('matches the RFC 7636 appendix B example', () => {
    expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('makes a fresh 43-character URL-safe verifier each time', () => {
    const a = createPkce();
    const b = createPkce();
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).toBe(challengeFor(a.verifier));
    expect(createState()).not.toBe(createState());
  });
});

describe('authorizeUrl', () => {
  it('asks for a code with an S256 challenge, the scopes and the state', () => {
    const url = authorizeUrl({
      baseUrl: 'https://login.example.org',
      clientId: 'client',
      redirectUri: 'http://localhost:8976/callback',
      scopes: ['openid', 'collection-search/ask'],
      state: 'st',
      challenge: 'ch',
    });
    expect(url.origin + url.pathname).toBe('https://login.example.org/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'client',
      redirect_uri: 'http://localhost:8976/callback',
      scope: 'openid collection-search/ask',
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    });
  });
});

const headerOf = (init: RequestInit | undefined, name: string) =>
  (init?.headers as Record<string, string> | undefined)?.[name];

describe('exchangeCode', () => {
  const params = {
    baseUrl: 'https://login.example.org',
    clientId: 'client',
    redirectUri: 'http://localhost:4321/auth/callback',
    code: 'the-code',
    verifier: 'the-verifier',
  };
  const ok = () =>
    vi.fn<typeof fetch>(async () => Response.json({ access_token: 'a', expires_in: 3600 }));

  it('sends the code and the PKCE verifier to the token endpoint', async () => {
    const fetchFn = ok();
    await exchangeCode(params, fetchFn);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://login.example.org/oauth2/token');
    const body = new URLSearchParams(String(init?.body));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toBe('the-verifier');
    expect(body.get('client_secret')).toBeNull();
    expect(headerOf(init, 'authorization')).toBeUndefined();
  });

  it('authenticates a confidential client with HTTP Basic, never in the body', async () => {
    const fetchFn = ok();
    await exchangeCode({ ...params, clientSecret: 's3cret' }, fetchFn);
    const [, init] = fetchFn.mock.calls[0] ?? [];
    expect(headerOf(init, 'authorization')).toBe(
      `Basic ${Buffer.from('client:s3cret').toString('base64')}`,
    );
    expect(String(init?.body)).not.toContain('s3cret');
  });

  it("reports Cognito's error code without echoing the request", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      Response.json({ error: 'invalid_grant' }, { status: 400 }),
    );
    await expect(exchangeCode(params, fetchFn)).rejects.toThrow(
      'Token exchange failed: HTTP 400 invalid_grant',
    );
  });
});
