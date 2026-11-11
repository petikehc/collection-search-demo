/**
 * Runs a full ingest in AWS: invokes the ingest Lambda and waits for its summary.
 * The Lambda fetches from the Collection API, builds a new index and swaps the `objects` alias.
 *
 *   pnpm ingest
 *   pnpm ingest --from objects-20261110235504   # rebuild from an existing index, no fetch
 */
import { parseArgs } from 'node:util';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { getStackOutputs, REGION } from './lib/stack-outputs.js';

const { values } = parseArgs({ options: { from: { type: 'string' } } });

const { IngestFunctionName } = await getStackOutputs('CollectionSearch-Search');
console.log(`Invoking ${IngestFunctionName} (takes about a minute)...`);

const lambda = new LambdaClient({ region: REGION });
const res = await lambda.send(
  new InvokeCommand({
    FunctionName: IngestFunctionName,
    LogType: 'Tail',
    Payload: JSON.stringify(values.from ? { reindexFrom: values.from } : {}),
  }),
);

const payload = res.Payload ? new TextDecoder().decode(res.Payload) : '';
if (res.FunctionError) {
  console.error(`Ingest failed (${res.FunctionError}):`, payload);
  console.error(Buffer.from(res.LogResult ?? '', 'base64').toString());
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(JSON.parse(payload), null, 2));
}
