/**
 * Calls the deployed API the way the web front end will: with the API key, and (for /ask and
 * /favourites) a Cognito access token from signing in on the managed login page.
 *
 * Sign-in uses the public `cli` app client: this opens the browser at managed login, listens on
 * localhost for the redirect, and exchanges the code with its PKCE verifier. The access token is
 * cached in data/ (gitignored, readable only by you) until it expires.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { CLI_CALLBACK_URL, RESOURCE_SERVER } from '../../functions/lib/auth/constants.js';
import {
  authorizeUrl,
  createPkce,
  createState,
  exchangeCode,
} from '../../functions/lib/auth/oauth.js';
import { getStackOutputs, REGION } from './stack-outputs.js';

export const scope = (name: string) => `${RESOURCE_SERVER}/${name}`;

const CACHE_DIR = new URL('../../data/', import.meta.url);
const CACHE_FILE = new URL('cli-tokens.json', CACHE_DIR);
const SIGN_IN_TIMEOUT_MS = 3 * 60_000;

type Cache = Record<string, { accessToken: string; expiresAt: number }>;

/** An access token with exactly these scopes, from the cache or by signing in. */
export async function accessToken(scopes: string[]): Promise<string> {
  const key = [...scopes].sort().join(' ');
  const cache = readCache();
  const cached = cache[key];
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;

  const tokens = await signIn(scopes);
  cache[key] = {
    accessToken: tokens.access_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), { mode: 0o600 });
  return tokens.access_token;
}

async function signIn(scopes: string[]) {
  const { LoginBaseUrl, CliClientId } = await getStackOutputs('CollectionSearch-Auth');
  if (!LoginBaseUrl || !CliClientId) throw new Error('Deploy CollectionSearch-Auth first');
  const pkce = createPkce();
  const state = createState();
  const redirect = new URL(CLI_CALLBACK_URL);
  const url = authorizeUrl({
    baseUrl: LoginBaseUrl,
    clientId: CliClientId,
    redirectUri: CLI_CALLBACK_URL,
    scopes,
    state,
    challenge: pkce.challenge,
  });

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const params = new URL(req.url ?? '/', CLI_CALLBACK_URL).searchParams;
      if (!req.url?.startsWith(redirect.pathname)) {
        res.writeHead(404).end();
        return;
      }
      const done = (status: number, message: string, result: () => void) => {
        res.writeHead(status, { 'content-type': 'text/plain' }).end(message);
        clearTimeout(timer);
        server.close();
        result();
      };
      if (params.get('state') !== state) {
        done(400, 'State mismatch.', () => reject(new Error('Sign-in failed: state mismatch')));
      } else if (params.get('error')) {
        const error = params.get('error');
        done(400, `Sign-in failed: ${error}`, () => reject(new Error(`Sign-in failed: ${error}`)));
      } else {
        done(200, 'Signed in. You can close this tab.', () => resolve(params.get('code') ?? ''));
      }
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Sign-in timed out'));
    }, SIGN_IN_TIMEOUT_MS);
    server.listen(Number(redirect.port), 'localhost', () => {
      console.error(`Opening the sign-in page (scopes: ${scopes.join(' ')}):\n  ${url}\n`);
      openBrowser(url.toString());
    });
  });

  return exchangeCode({
    baseUrl: LoginBaseUrl,
    clientId: CliClientId,
    redirectUri: CLI_CALLBACK_URL,
    code,
    verifier: pkce.verifier,
  });
}

let apiKey: string | undefined;

/** The web front end's API key, read from Secrets Manager with your AWS credentials. */
export async function getApiKey(): Promise<string> {
  if (apiKey) return apiKey;
  const { ApiKeySecretArn } = await getStackOutputs('CollectionSearch-Api');
  const sm = new SecretsManagerClient({ region: REGION });
  const { SecretString } = await sm.send(new GetSecretValueCommand({ SecretId: ApiKeySecretArn }));
  apiKey = SecretString ?? '';
  return apiKey;
}

export interface CallOptions {
  body?: unknown;
  /** Sign in and send an access token with these scopes; omit for no token. */
  scopes?: string[];
  /** Send the API key (default true). */
  key?: boolean;
}

export async function callApi(method: string, path: string, opts: CallOptions = {}) {
  const { ApiUrl } = await getStackOutputs('CollectionSearch-Api');
  const headers: Record<string, string> = {};
  if (opts.key !== false) headers['x-api-key'] = await getApiKey();
  if (opts.scopes) headers.authorization = `Bearer ${await accessToken(opts.scopes)}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';

  const started = Date.now();
  const res = await fetch(new URL(path.replace(/^\//, ''), ApiUrl), {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    // not JSON: keep the text
  }
  return { status: res.status, ms: Date.now() - started, json };
}

function readCache(): Cache {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as Cache;
  } catch {
    return {};
  }
}

function openBrowser(url: string) {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  spawn(command, [url], { stdio: 'ignore', detached: true }).unref();
}
