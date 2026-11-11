/**
 * Runs the evaluation set (evals/questions.jsonl) through the same askCollection code as the
 * /ask Lambda, scores retrieval, behaviour and answer quality (LLM judge), and writes
 * evals/results/<date>-<label>.md and .json.
 *
 *   pnpm eval --label baseline
 *
 * Costs about $0.50 per run (25 answers with Haiku 4.5 + 25 judge calls with Sonnet 4.6).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  BedrockAgentRuntimeClient,
  type KnowledgeBaseRetrievalResult,
  RetrieveCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { type AskConfig, askCollection, buildRequest } from '../functions/lib/ask/ask.js';
import { expandQuestion } from '../functions/lib/ask/expand.js';
import {
  type CaseResult,
  type EvalCase,
  expectationMet,
  parseJudge,
  recallAt,
  summariseByCategory,
} from './lib/eval-score.js';
import { getStackOutputs, REGION } from './lib/stack-outputs.js';

const JUDGE_MODEL = 'au.anthropic.claude-sonnet-4-6';
const TOP_K = 6;

const { values } = parseArgs({ options: { label: { type: 'string', default: 'run' } } });
const label = values.label ?? 'run';

const root = new URL('../evals/', import.meta.url);
const cases: EvalCase[] = (await readFile(new URL('questions.jsonl', root), 'utf8'))
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const ai = await getStackOutputs('CollectionSearch-Ai');
const api = await getStackOutputs('CollectionSearch-Api');
const config: AskConfig = {
  knowledgeBaseId: ai.KnowledgeBaseId ?? '',
  modelArn: api.AskModelArn ?? '',
  guardrailId: api.GuardrailId ?? '',
  guardrailVersion: api.GuardrailVersion ?? '',
  numberOfResults: TOP_K,
};

const agent = new BedrockAgentRuntimeClient({ region: REGION });
const runtime = new BedrockRuntimeClient({ region: REGION });

const results: CaseResult[] = [];
for (const c of cases) {
  const started = Date.now();
  // The same retrieval RetrieveAndGenerate does, to see everything retrieved (citations only
  // show what the model chose to use) and to give the judge the passages the model saw.
  const retrieved = await retrieve(expandQuestion(c.question));
  const res = await askCollection(agent, c.question, config);
  const blocked = res.guardrailAction === 'INTERVENED';
  const retrievedIds = retrieved.map((r) => String(r.metadata?.objectId ?? ''));

  const result: CaseResult = {
    id: c.id,
    category: c.category,
    expect: c.expect,
    question: c.question,
    answer: res.answer,
    blocked,
    retrievedIds,
    citedIds: res.citations.map((x) => x.objectId),
    expectationMet: expectationMet(c, res.answer, blocked),
    ms: Date.now() - started,
  };
  if (c.expectedObjectIds) {
    result.recall = recallAt(c.expectedObjectIds, retrievedIds, TOP_K);
    result.hit = result.recall > 0;
  }
  if (!blocked) Object.assign(result, await judge(c.question, retrieved, res.answer));
  results.push(result);

  console.log(
    `${result.expectationMet ? 'ok  ' : 'MISS'} ${c.id.padEnd(26)}` +
      `${result.recall === undefined ? '' : ` recall ${result.recall.toFixed(2)}`}` +
      `${blocked ? ' blocked' : ` faithful ${result.faithfulness} helpful ${result.helpfulness}`}`,
  );
  await new Promise((r) => setTimeout(r, 1000)); // gentle on Bedrock quotas
}

await writeResults();

async function retrieve(question: string): Promise<KnowledgeBaseRetrievalResult[]> {
  const kb = buildRequest(question, config).retrieveAndGenerateConfiguration
    ?.knowledgeBaseConfiguration;
  const { retrievalResults = [] } = await agent.send(
    new RetrieveCommand({
      knowledgeBaseId: config.knowledgeBaseId,
      retrievalQuery: { text: question },
      retrievalConfiguration: kb?.retrievalConfiguration,
    }),
  );
  return retrievalResults;
}

async function judge(question: string, passages: KnowledgeBaseRetrievalResult[], answer: string) {
  const sources = passages
    // The whole passage, as the answering model saw it. A first version cut passages at 1,500
    // characters, and the judge then called correct details from later in a record "invented".
    .map((p, i) => `<passage id="${i + 1}">\n${p.content?.text}\n</passage>`)
    .join('\n');
  const prompt = `You are evaluating an answer from a museum collection question-answering system. The system may only use the retrieved passages. Be strict and consistent.

<question>${question}</question>
<passages>
${sources}
</passages>
<answer>${answer}</answer>

Score the answer:
- faithfulness (1-5): 5 = every factual claim is supported by the passages; 3 = some claims are not supported; 1 = mostly unsupported or invented. Saying the passages don't cover something is not a factual claim.
- helpfulness (1-5): 5 = directly answers the question using the relevant passages, or clearly says the records don't cover it when the passages lack the answer; 3 = partly answers or misses relevant passages; 1 = unhelpful or off-topic.

Reply with only JSON: {"faithfulness": <1-5>, "helpfulness": <1-5>, "reason": "<one sentence>"}`;

  const res = await runtime.send(
    new ConverseCommand({
      modelId: JUDGE_MODEL,
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { temperature: 0, maxTokens: 300 },
    }),
  );
  const text = res.output?.message?.content?.[0]?.text ?? '';
  const scores = parseJudge(text);
  return { ...scores, judgeReason: scores.reason };
}

async function writeResults() {
  const date = new Date().toISOString().slice(0, 10);
  const dir = new URL('results/', root);
  await mkdir(dir, { recursive: true });
  const base = `${date}-${label}`;
  const summary = summariseByCategory(results);
  const meta = {
    date,
    label,
    generationModel: config.modelArn.split('/').pop(),
    judgeModel: JUDGE_MODEL,
    guardrailVersion: config.guardrailVersion,
    topK: TOP_K,
  };
  await writeFile(
    new URL(`${base}.json`, dir),
    `${JSON.stringify({ meta, summary, results }, null, 2)}\n`,
  );

  const pct = (n?: number) => (n === undefined ? '–' : `${Math.round(n * 100)}%`);
  const num = (n?: number) => (n === undefined ? '–' : n.toFixed(2));
  const lines = [
    `# Eval: ${label} (${date})`,
    '',
    `Generation: \`${meta.generationModel}\` · Judge: \`${JUDGE_MODEL}\` · Guardrail v${meta.guardrailVersion} · top ${TOP_K}`,
    '',
    '| Category | Cases | Expectation met | Recall@6 | Hit@6 | Faithfulness | Helpfulness |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...summary.map(
      ([name, s]) =>
        `| ${name} | ${s.cases} | ${pct(s.expectationRate)} | ${pct(s.meanRecall)} | ${pct(s.hitRate)} | ${num(s.meanFaithfulness)} | ${num(s.meanHelpfulness)} |`,
    ),
    '',
    '## Cases',
    '',
    '| Case | Met | Recall | Faithful | Helpful | Judge |',
    '| --- | --- | --- | --- | --- | --- |',
    ...results.map(
      (r) =>
        `| ${r.id} | ${r.expectationMet ? 'yes' : '**no**'} | ${r.recall === undefined ? '–' : pct(r.recall)} | ${r.faithfulness ?? '–'} | ${r.helpfulness ?? (r.blocked ? 'blocked' : '–')} | ${(r.judgeReason ?? '').replaceAll('|', '/')} |`,
    ),
    '',
    'Collection data: National Museum of Australia Collection API, CC BY-NC 4.0.',
    '',
  ];
  await writeFile(new URL(`${base}.md`, dir), lines.join('\n'));
  console.log(`\nWrote evals/results/${base}.md and .json`);
  for (const [name, s] of summary) {
    console.log(
      `  ${name.padEnd(13)} met ${pct(s.expectationRate).padStart(4)}  recall ${pct(s.meanRecall).padStart(4)}  faithful ${num(s.meanFaithfulness)}  helpful ${num(s.meanHelpfulness)}`,
    );
  }
}
