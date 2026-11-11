/**
 * Calls POST /ask through API Gateway like the web front end does: with the API key and an access
 * token carrying the `ask` scope (signs you in through the browser the first time; see lib/api.ts).
 * Prints the answer and its citations.
 *
 *   pnpm ask "What did people use to start fires?"
 */
import { callApi, scope } from './lib/api.js';

const question = process.argv.slice(2).join(' ');
if (!question) throw new Error('Usage: pnpm ask "your question"');

const { status, ms, json } = await callApi('POST', '/ask', {
  body: { question },
  scopes: ['openid', scope('ask')],
});
const res = json as {
  answer?: string;
  citations?: { objectId: string; title: string; sourceUrl: string }[];
  guardrailAction?: string;
  message?: string;
};

console.log(`HTTP ${status} in ${(ms / 1000).toFixed(1)} s\n`);
if (status !== 200) {
  console.log(res?.message ?? res);
  process.exitCode = 1;
} else {
  console.log(res.answer);
  console.log(`\nGuardrail: ${res.guardrailAction}`);
  for (const c of res.citations ?? [])
    console.log(`  [${c.objectId}] ${c.title}\n      ${c.sourceUrl}`);
}
