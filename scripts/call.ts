/**
 * Calls any API operation and prints the status and body: handy for checking auth.
 *
 *   pnpm call GET /bookmarks                               (token with the bookmarks scope + API key)
 *   pnpm call PUT /bookmarks/27954 '{"title":"Method of lighting fire"}'
 *   pnpm call GET /bookmarks --scopes openid               (valid token, wrong scope)
 *   pnpm call GET /bookmarks --no-token                    (no token)
 *   pnpm call GET /bookmarks --no-key                      (no API key)
 */
import { parseArgs } from 'node:util';
import { callApi, scope } from './lib/api.js';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    scopes: { type: 'string' },
    'no-token': { type: 'boolean', default: false },
    'no-key': { type: 'boolean', default: false },
  },
});
const [method, path, body] = positionals;
if (!method || !path) throw new Error('Usage: pnpm call <METHOD> <path> [json body] [options]');

const scopes = values['no-token']
  ? undefined
  : (values.scopes?.split(',') ?? ['openid', scope('bookmarks')]);

const res = await callApi(method.toUpperCase(), path, {
  body: body === undefined ? undefined : JSON.parse(body),
  scopes,
  key: !values['no-key'],
});
console.log(`HTTP ${res.status} in ${res.ms} ms`);
if (res.json !== undefined) console.log(JSON.stringify(res.json, null, 2));
