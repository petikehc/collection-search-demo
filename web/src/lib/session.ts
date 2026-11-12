/**
 * Sign-in for the web server: authorisation code grant with PKCE against Cognito's managed login,
 * tokens kept in httpOnly cookies (JavaScript in the page can't read them), checked on every
 * request with aws-jwt-verify.
 */
import type { AstroCookieSetOptions, AstroCookies } from 'astro';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import {
  RESOURCE_SERVER,
  webCallbackUrl,
  webLogoutUrl,
} from '../../../functions/lib/auth/constants.js';
import {
  authorizeUrl,
  createPkce,
  createState,
  exchangeCode,
  logoutUrl,
  refreshTokens,
  revokeToken,
} from '../../../functions/lib/auth/oauth.js';
import { addBookmark } from './api.js';
import { getConfig } from './config.js';
import type { PendingBookmark } from './pending.js';

export type User = NonNullable<App.Locals['user']>;

const SCOPES = ['openid', 'email', `${RESOURCE_SERVER}/bookmarks`];

const COOKIE = {
  login: 'cs_login', // PKCE verifier, state and return path, for the 10 minutes a sign-in takes
  access: 'cs_access',
  id: 'cs_id',
  refresh: 'cs_refresh',
} as const;

const HOUR = 3600;

/**
 * httpOnly: not readable by page scripts. SameSite=Lax: sent on top-level navigations (including
 * Cognito's redirect back to us) but not on cross-site form posts or fetches. Secure whenever
 * the site is served over HTTPS (it's plain http on localhost).
 */
function cookieOptions(url: URL, maxAge: number): AstroCookieSetOptions {
  return { httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', path: '/', maxAge };
}

/** Only a path on this site: never `//evil.example` or a full URL (an open redirect). */
export function safeReturnTo(value: string | null | undefined): string {
  return value?.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')
    ? value
    : '/';
}

/**
 * Step 1: remember a fresh PKCE verifier and state, then send the user to managed login.
 * The callback is on whichever origin served this request (localhost or the hosted site). That's
 * safe: Astro only trusts the hosts in `security.allowedDomains`, and Cognito only redirects to
 * the callback URLs registered for the client.
 */
export async function startLogin(
  cookies: AstroCookies,
  url: URL,
  returnTo: string,
  /** A bookmark to save once signed in (the visitor clicked one while signed out). */
  pending?: PendingBookmark,
): Promise<URL> {
  const { loginBaseUrl, clientId } = await getConfig();
  const pkce = createPkce();
  const state = createState();
  cookies.set(
    COOKIE.login,
    JSON.stringify({ verifier: pkce.verifier, state, returnTo: safeReturnTo(returnTo), pending }),
    cookieOptions(url, 600),
  );
  return authorizeUrl({
    baseUrl: loginBaseUrl,
    clientId,
    redirectUri: webCallbackUrl(url.origin),
    scopes: SCOPES,
    state,
    challenge: pkce.challenge,
  });
}

/** Step 2: Cognito redirected back with a code. Check state, exchange the code, keep the tokens. */
export async function finishLogin(cookies: AstroCookies, url: URL): Promise<string> {
  const login = cookies.get(COOKIE.login)?.json() as
    | { verifier: string; state: string; returnTo: string; pending?: PendingBookmark }
    | undefined;
  cookies.delete(COOKIE.login, { path: '/' });

  const error = url.searchParams.get('error');
  if (error) throw new Error(`Sign-in failed: ${error}`);
  // The state must be the one we just set in this browser: stops an attacker's code being
  // planted into our session (login CSRF).
  if (!login || url.searchParams.get('state') !== login.state) {
    throw new Error('Sign-in expired or was started elsewhere. Please try again.');
  }

  const config = await getConfig();
  const tokens = await exchangeCode({
    baseUrl: config.loginBaseUrl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: webCallbackUrl(url.origin),
    code: url.searchParams.get('code') ?? '',
    verifier: login.verifier,
  });
  // Don't trust a token just because it arrived over HTTPS from Cognito: verify before storing.
  await (await verifiers()).access.verify(tokens.access_token);
  cookies.set(COOKIE.access, tokens.access_token, cookieOptions(url, tokens.expires_in));
  cookies.set(COOKIE.id, tokens.id_token, cookieOptions(url, tokens.expires_in));
  if (tokens.refresh_token) {
    cookies.set(COOKIE.refresh, tokens.refresh_token, cookieOptions(url, 24 * HOUR));
  }
  // The bookmark that started this sign-in. Saving it is best effort: the visitor is signed in
  // either way, and can press the button again.
  if (login.pending) {
    await addBookmark(tokens.access_token, login.pending.objectId, login.pending.title).catch(
      (err) => console.error('pending bookmark failed', err),
    );
  }
  return login.returnTo;
}

/**
 * The signed-in user, or undefined. Verifies the access token (signature, expiry, issuer, that
 * it's an access token for *our* web client); if it has expired, uses the refresh token once.
 */
export async function currentUser(cookies: AstroCookies, url: URL): Promise<User | undefined> {
  const accessToken = cookies.get(COOKIE.access)?.value;
  const idToken = cookies.get(COOKIE.id)?.value;
  if (accessToken) {
    const user = await verifyUser(accessToken, idToken);
    if (user) return user;
  }

  const refreshToken = cookies.get(COOKIE.refresh)?.value;
  if (!refreshToken) return undefined;
  try {
    const config = await getConfig();
    const tokens = await refreshTokens({
      baseUrl: config.loginBaseUrl,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken,
    });
    const user = await verifyUser(tokens.access_token, tokens.id_token);
    if (!user) throw new Error('Refreshed token failed verification');
    cookies.set(COOKIE.access, tokens.access_token, cookieOptions(url, tokens.expires_in));
    cookies.set(COOKIE.id, tokens.id_token, cookieOptions(url, tokens.expires_in));
    return user;
  } catch {
    // Expired or revoked refresh token: signed out.
    clearSession(cookies);
    return undefined;
  }
}

/**
 * Sign out everywhere we can: revoke the refresh token (no new access tokens), delete our
 * cookies, and end the Cognito session (or managed login would sign the user straight back in).
 * An access token already issued still works at the API until it expires (up to an hour).
 */
export async function logout(cookies: AstroCookies, url: URL): Promise<URL> {
  const config = await getConfig();
  const refreshToken = cookies.get(COOKIE.refresh)?.value;
  if (refreshToken) {
    await revokeToken({
      baseUrl: config.loginBaseUrl,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken,
    }).catch(() => undefined); // already expired or revoked: nothing more to do
  }
  clearSession(cookies);
  return logoutUrl({
    baseUrl: config.loginBaseUrl,
    clientId: config.clientId,
    logoutUri: webLogoutUrl(url.origin),
  });
}

function clearSession(cookies: AstroCookies) {
  for (const name of [COOKIE.access, COOKIE.id, COOKIE.refresh])
    cookies.delete(name, { path: '/' });
}

async function verifyUser(accessToken: string, idToken?: string): Promise<User | undefined> {
  const { access, id } = await verifiers();
  try {
    const payload = await access.verify(accessToken);
    // The ID token is only for showing who's signed in; access decisions use the access token.
    const email = idToken
      ? await id
          .verify(idToken)
          .then((p) => (typeof p.email === 'string' ? p.email : undefined))
          .catch(() => undefined)
      : undefined;
    return {
      sub: payload.sub,
      email,
      scopes: String(payload.scope ?? '').split(' '),
      accessToken,
    };
  } catch {
    return undefined;
  }
}

let cached: ReturnType<typeof createVerifiers> | undefined;

function verifiers() {
  cached ??= createVerifiers().catch((err) => {
    cached = undefined;
    throw err;
  });
  return cached;
}

async function createVerifiers() {
  const { userPoolId, clientId } = await getConfig();
  // Fetches the pool's public keys (JWKS) once and caches them; each verify is then local.
  return {
    access: CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: 'access' }),
    id: CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: 'id' }),
  };
}
