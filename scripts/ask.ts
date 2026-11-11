/**
 * Calls POST /ask through API Gateway, signing the request with your AWS credentials (SigV4),
 * the same way any IAM-authorised client would. Prints the answer and its citations.
 *
 *   pnpm ask "What did people use to start fires?"
 */
import { Sha256 } from '@aws-crypto/sha256-js';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { SignatureV4 } from '@smithy/signature-v4';
import { getStackOutputs, REGION } from './lib/stack-outputs.js';

const question = process.argv.slice(2).join(' ');
if (!question) throw new Error('Usage: pnpm ask "your question"');

const { ApiUrl } = await getStackOutputs('CollectionSearch-Api');
const url = new URL('ask', ApiUrl);
const body = JSON.stringify({ question });

// Sign for the API Gateway service ("execute-api"); the signature covers method, path,
// headers and body, so none of them can be changed in transit.
const signer = new SignatureV4({
  service: 'execute-api',
  region: REGION,
  credentials: fromNodeProviderChain(),
  sha256: Sha256,
});
const signed = await signer.sign({
  method: 'POST',
  protocol: url.protocol,
  hostname: url.hostname,
  path: url.pathname,
  headers: { host: url.hostname, 'content-type': 'application/json' },
  body,
});

const started = Date.now();
const res = await fetch(url, { method: 'POST', headers: signed.headers, body });
const json = (await res.json()) as {
  answer?: string;
  citations?: { objectId: string; title: string; sourceUrl: string }[];
  guardrailAction?: string;
  message?: string;
};

console.log(`HTTP ${res.status} in ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
if (!res.ok) {
  console.log(json.message ?? json);
  process.exitCode = 1;
} else {
  console.log(json.answer);
  console.log(`\nGuardrail: ${json.guardrailAction}`);
  for (const c of json.citations ?? [])
    console.log(`  [${c.objectId}] ${c.title}\n      ${c.sourceUrl}`);
}
