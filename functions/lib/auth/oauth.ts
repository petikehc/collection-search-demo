import { createHash, randomBytes } from 'node:crypto';

/**
 * OAuth 2.0 authorisation code grant with PKCE (RFC 7636) against Cognito's managed login.
 * Shared by the command-line tools and the web server.
 *
 * PKCE: the app makes a random `verifier`, sends only its SHA-256 (`challenge`) when the user
 * goes to sign in, then sends the verifier itself when exchanging the code for tokens. Someone
 * who intercepts the code can't exchange it without the verifier.
 */

export interface Pkce {
  verifier: string;
  challenge: string;
}

export interface Tokens {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: 'Bearer';
}

export function createPkce(): Pkce {
  // 32 random bytes → 43 base64url characters, the minimum length RFC 7636 allows.
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: challengeFor(verifier) };
}

export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Random value tied to this sign-in attempt; the callback must return it unchanged (CSRF). */
export function createState(): string {
  return randomBytes(16).toString('base64url');
}

export interface AuthorizeParams {
  /** The user pool domain, e.g. https://<prefix>.auth.<region>.amazoncognito.com */
  baseUrl: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  challenge: string;
}

export function authorizeUrl(p: AuthorizeParams): URL {
  const url = new URL('/oauth2/authorize', p.baseUrl);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    scope: p.scopes.join(' '),
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
  }).toString();
  return url;
}

/** An app client's credentials. Public clients (the CLI) have no secret and rely on PKCE. */
export interface ClientCredentials {
  baseUrl: string;
  clientId: string;
  clientSecret?: string;
}

export interface ExchangeParams extends ClientCredentials {
  redirectUri: string;
  code: string;
  verifier: string;
}

export function exchangeCode(p: ExchangeParams, fetchFn = fetch): Promise<Tokens> {
  return postForm<Tokens>(p, '/oauth2/token', fetchFn, {
    grant_type: 'authorization_code',
    client_id: p.clientId,
    code: p.code,
    redirect_uri: p.redirectUri,
    code_verifier: p.verifier,
  });
}

/** New access and ID tokens from a refresh token (Cognito doesn't return a new refresh token). */
export function refreshTokens(
  p: ClientCredentials & { refreshToken: string },
  fetchFn = fetch,
): Promise<Omit<Tokens, 'refresh_token'>> {
  return postForm(p, '/oauth2/token', fetchFn, {
    grant_type: 'refresh_token',
    client_id: p.clientId,
    refresh_token: p.refreshToken,
  });
}

/**
 * Revokes a refresh token, so it can't mint new access tokens. Access tokens already issued
 * stay valid until they expire: API Gateway checks them locally and never asks Cognito.
 */
export async function revokeToken(
  p: ClientCredentials & { refreshToken: string },
  fetchFn = fetch,
): Promise<void> {
  await postForm(p, '/oauth2/revoke', fetchFn, {
    client_id: p.clientId,
    token: p.refreshToken,
  });
}

/** Ends the user's session on Cognito's managed login too, then returns them to `logoutUri`. */
export function logoutUrl(p: { baseUrl: string; clientId: string; logoutUri: string }): URL {
  const url = new URL('/logout', p.baseUrl);
  url.search = new URLSearchParams({ client_id: p.clientId, logout_uri: p.logoutUri }).toString();
  return url;
}

async function postForm<T>(
  client: ClientCredentials,
  path: string,
  fetchFn: typeof fetch,
  form: Record<string, string>,
): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (client.clientSecret) {
    const basic = Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64');
    headers.authorization = `Basic ${basic}`;
  }
  const res = await fetchFn(new URL(path, client.baseUrl), {
    method: 'POST',
    headers,
    body: new URLSearchParams(form),
  });
  if (!res.ok) {
    // Cognito returns {"error": "invalid_grant"} and similar; never echo the request back.
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`${path} failed: HTTP ${res.status} ${error ?? ''}`.trim());
  }
  // /oauth2/revoke returns an empty body.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
