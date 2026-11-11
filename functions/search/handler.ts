import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { expandQuestion } from '../lib/ask/expand.js';
import { createOpenSearchClient } from '../lib/opensearch/client.js';
import { OBJECTS_ALIAS } from '../lib/search/constants.js';
import { createEmbedder } from '../lib/search/embed.js';
import {
  buildSearchBody,
  isHybrid,
  type OpenSearchSearchBody,
  parseSearchParams,
  toSearchResponse,
} from '../lib/search/query.js';
import { cached } from '../lib/search/query-vector.js';

// Service name and metrics namespace come from POWERTOOLS_* environment variables.
const logger = new Logger();
const metrics = new Metrics();
// Creating the tracer patches Node's http/https, so each OpenSearch call shows up in X-Ray.
new Tracer();

// Created once per container and reused across invocations.
const client = createOpenSearchClient({
  endpoint: process.env.DOMAIN_ENDPOINT ?? '',
  region: process.env.AWS_REGION ?? '',
});
// Paging and filtering repeat the same words, so recent query vectors are kept per container.
const embedQuery = cached(createEmbedder(new BedrockRuntimeClient({})));

/**
 * GET /search: validates parameters, embeds the query for hybrid search, queries the `objects`
 * alias, and maps the result to the API contract.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  logger.appendKeys({ requestId: event.requestContext?.requestId });
  try {
    const parsed = parseSearchParams(event.queryStringParameters);
    if (!parsed.ok) return json(400, { message: parsed.message });

    const { params } = parsed;
    const queryVector = isHybrid(params) ? await vectorFor(params.q ?? '') : undefined;
    // transport.request rather than client.search: the client's generated request types reject
    // valid aggregations (e.g. `terms.field`). The body is covered by unit tests and live runs.
    const res = await client.transport.request({
      method: 'POST',
      path: `/${OBJECTS_ALIAS}/_search`,
      body: buildSearchBody(params, queryVector),
    });
    const body = toSearchResponse(res.body as OpenSearchSearchBody, params);

    metrics.addMetric('Searches', MetricUnit.Count, 1);
    if (params.q && body.keywordTotal === 0) {
      // Queries that match no words are the main signal for missing synonyms or stemming gaps
      // (in a hybrid search the visitor still sees the nearest objects by meaning).
      metrics.addMetric('ZeroResultSearches', MetricUnit.Count, 1);
      // Questions go in the same box and may hold personal details, so only short
      // keyword-style queries are logged in full.
      const words = params.q.split(/\s+/).length;
      logger.info('zero results', {
        q: words <= 3 ? params.q : undefined,
        words,
        type: params.type,
        place: params.place,
      });
    }
    return json(200, body);
  } catch (err) {
    logger.error('search failed', err as Error);
    return json(500, { message: 'Search is temporarily unavailable' });
  } finally {
    metrics.publishStoredMetrics();
    logger.resetKeys();
  }
}

/**
 * The query's vector, with the keyword analyser's synonyms added first: the embedding model
 * doesn't know that a woomera is a spear-thrower. If embedding fails (throttling, an outage),
 * the search still runs on keywords alone rather than failing.
 */
async function vectorFor(q: string): Promise<number[] | undefined> {
  try {
    return await embedQuery(expandQuestion(q));
  } catch (err) {
    metrics.addMetric('HybridFallbacks', MetricUnit.Count, 1);
    logger.warn('query embedding failed; keyword search only', { error: (err as Error).message });
    return undefined;
  }
}

function json(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}
