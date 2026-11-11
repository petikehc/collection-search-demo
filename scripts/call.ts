/**
 * Calls any API operation and prints the status and body: handy for checking auth.
 *
 *   pnpm call GET /favourites                               (token with both scopes + API key)
 *   pnpm call PUT /favourites/27954 '{"title":"Method of lighting fire"}'
 *   pnpm call GET /favourites --scopes openid               (valid token, wrong scope)
 *   pnpm call GET /favourites --no-token                    (no token)
 *   pnpm call GET /favourites --no-key                      (no API key)
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
  : (values.scopes?.split(',') ?? ['openid', scope('ask'), scope('favourites')]);

const res = await callApi(method.toUpperCase(), path, {
  body: body === undefined ? undefined : JSON.parse(body),
  scopes,
  key: !values['no-key'],
});
console.log(`HTTP ${res.status} in ${res.ms} ms`);
if (res.json !== undefined) console.log(JSON.stringify(res.json, null, 2));
