/**
 * Retrieval only (no generation): shows which collection objects the Knowledge Base finds for a
 * question, with their similarity scores. Useful for checking retrieval before blaming the model.
 *
 *   pnpm kb:retrieve "What was used to start fires?"
 */
import { BedrockAgentRuntimeClient, RetrieveCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { getStackOutputs, REGION } from './lib/stack-outputs.js';

const question = process.argv.slice(2).join(' ');
if (!question) throw new Error('Usage: pnpm kb:retrieve "your question"');

const { KnowledgeBaseId } = await getStackOutputs('CollectionSearch-Ai');
const runtime = new BedrockAgentRuntimeClient({ region: REGION });

const { retrievalResults = [] } = await runtime.send(
  new RetrieveCommand({
    knowledgeBaseId: KnowledgeBaseId,
    retrievalQuery: { text: question },
    retrievalConfiguration: { vectorSearchConfiguration: { numberOfResults: 6 } },
  }),
);

console.log(`"${question}"\n`);
for (const r of retrievalResults) {
  const title = (r.metadata?.title as string | undefined) ?? '?';
  console.log(`${(r.score ?? 0).toFixed(3)}  ${title}  (object ${r.metadata?.objectId})`);
}
