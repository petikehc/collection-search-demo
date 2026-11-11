/**
 * Syncs the Knowledge Base with the documents in S3 (run after `pnpm ingest`): starts an
 * ingestion job and waits for it. Bedrock embeds new and changed files and removes deleted ones.
 *
 *   pnpm kb:sync
 */
import {
  BedrockAgentClient,
  GetIngestionJobCommand,
  StartIngestionJobCommand,
} from '@aws-sdk/client-bedrock-agent';
import { getStackOutputs, REGION } from './lib/stack-outputs.js';

const { KnowledgeBaseId, DataSourceId } = await getStackOutputs('CollectionSearch-Ai');
const agent = new BedrockAgentClient({ region: REGION });

const { ingestionJob } = await agent.send(
  new StartIngestionJobCommand({ knowledgeBaseId: KnowledgeBaseId, dataSourceId: DataSourceId }),
);
const ids = {
  knowledgeBaseId: KnowledgeBaseId,
  dataSourceId: DataSourceId,
  ingestionJobId: ingestionJob?.ingestionJobId,
};
console.log(`Started ingestion job ${ids.ingestionJobId}`);

const started = Date.now();
for (;;) {
  await new Promise((r) => setTimeout(r, 5000));
  const { ingestionJob: job } = await agent.send(new GetIngestionJobCommand(ids));
  const s = job?.statistics;
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(
    `  ${String(seconds).padStart(4)} s  ${job?.status}  scanned ${s?.numberOfDocumentsScanned ?? 0}, ` +
      `new ${s?.numberOfNewDocumentsIndexed ?? 0}, modified ${s?.numberOfModifiedDocumentsIndexed ?? 0}, ` +
      `deleted ${s?.numberOfDocumentsDeleted ?? 0}, failed ${s?.numberOfDocumentsFailed ?? 0}`,
  );
  if (job?.status === 'COMPLETE') break;
  if (job?.status === 'FAILED' || job?.status === 'STOPPED') {
    console.error('Failure reasons:', job.failureReasons);
    process.exit(1);
  }
}
