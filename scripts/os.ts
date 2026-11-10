/**
 * Sends one signed request to the OpenSearch domain as the admin role, and prints the response.
 * A small stand-in for Dashboards' Dev Tools console.
 *
 *   pnpm os GET /_cluster/health
 *   pnpm os GET '/_cat/indices?v'
 *   pnpm os PUT /my-index '{"settings": {"number_of_replicas": 0}}'
 *   pnpm os POST /my-index/_search @query.json
 */
import { readFile } from 'node:fs/promises';
import { createOpenSearchClient } from '../functions/lib/opensearch/client.js';
import { getStackOutputs, REGION } from './lib/stack-outputs.js';

const [method = 'GET', path = '/', bodyArg] = process.argv.slice(2);

const outputs = await getStackOutputs('CollectionSearch-Search');
const client = createOpenSearchClient({
  endpoint: outputs.DomainEndpoint ?? '',
  region: REGION,
  assumeRoleArn: outputs.AdminRoleArn,
});

const body = bodyArg?.startsWith('@') ? await readFile(bodyArg.slice(1), 'utf8') : bodyArg;

try {
  const res = await client.transport.request({ method: method.toUpperCase(), path, body });
  console.log(typeof res.body === 'string' ? res.body : JSON.stringify(res.body, null, 2));
} catch (err) {
  const meta = (err as { meta?: { statusCode?: number; body?: unknown } }).meta;
  console.error(
    `HTTP ${meta?.statusCode ?? '?'}`,
    JSON.stringify(meta?.body ?? String(err), null, 2),
  );
  process.exitCode = 1;
}
