import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { BedrockAgentRuntimeClient } from '@aws-sdk/client-bedrock-agent-runtime';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { type AskConfig, askCollection } from '../lib/ask/ask.js';

const logger = new Logger();
const metrics = new Metrics();
const tracer = new Tracer();

const client = tracer.captureAWSv3Client(new BedrockAgentRuntimeClient({}));
const config: AskConfig = {
  knowledgeBaseId: process.env.KNOWLEDGE_BASE_ID ?? '',
  modelArn: process.env.MODEL_ARN ?? '',
  guardrailId: process.env.GUARDRAIL_ID ?? '',
  guardrailVersion: process.env.GUARDRAIL_VERSION ?? '',
};

export function parseQuestion(body: string | null): { question: string } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body ?? '');
  } catch {
    return { error: 'Body must be JSON: {"question": "..."}' };
  }
  const question = (parsed as { question?: unknown })?.question;
  if (typeof question !== 'string') return { error: 'question must be a string' };
  const trimmed = question.trim();
  if (trimmed.length < 3 || trimmed.length > 500) {
    return { error: 'question must be 3 to 500 characters' };
  }
  return { question: trimmed };
}

/**
 * POST /ask: retrieve-augment-generate over the collection with the guardrail applied.
 * Logs metadata only, never the question: it may contain personal details, and the full text is
 * kept in the model invocation log, where CloudWatch data protection masks them.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  logger.appendKeys({ requestId: event.requestContext?.requestId });
  const started = Date.now();
  try {
    const parsed = parseQuestion(event.body);
    if ('error' in parsed) return json(400, { message: parsed.error });

    const res = await askCollection(client, parsed.question, config);

    metrics.addMetric('AskRequests', MetricUnit.Count, 1);
    if (res.guardrailAction === 'INTERVENED') {
      metrics.addMetric('GuardrailInterventions', MetricUnit.Count, 1);
    }
    logger.info('answered', {
      questionLength: parsed.question.length,
      guardrailAction: res.guardrailAction,
      citations: res.citations.length,
      ms: Date.now() - started,
    });
    return json(200, res);
  } catch (err) {
    logger.error('ask failed', err as Error);
    return json(500, { message: 'Ask is temporarily unavailable' });
  } finally {
    metrics.publishStoredMetrics();
    logger.resetKeys();
  }
}

function json(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}
