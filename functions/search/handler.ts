import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { Tracer } from '@aws-lambda-powertools/tracer';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createOpenSearchClient } from '../lib/opensearch/client.js';
import { OBJECTS_ALIAS } from '../lib/search/constants.js';
import {
  buildSearchBody,
  type OpenSearchSearchBody,
  parseSearchParams,
  toSearchResponse,
} from '../lib/search/query.js';

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

/** GET /search: validates parameters, queries the `objects` alias, maps to the API contract. */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  logger.appendKeys({ requestId: event.requestContext?.requestId });
  try {
    const parsed = parseSearchParams(event.queryStringParameters);
    if (!parsed.ok) return json(400, { message: parsed.message });

    const { params } = parsed;
    // transport.request rather than client.search: the client's generated request types reject
    // valid aggregations (e.g. `terms.field`). The body is covered by unit tests and live runs.
    const res = await client.transport.request({
      method: 'POST',
      path: `/${OBJECTS_ALIAS}/_search`,
      body: buildSearchBody(params),
    });
    const body = toSearchResponse(res.body as OpenSearchSearchBody, params);

    metrics.addMetric('Searches', MetricUnit.Count, 1);
    if (params.q && body.total === 0) {
      // Zero-result queries are the main signal for missing synonyms or stemming gaps.
      metrics.addMetric('ZeroResultSearches', MetricUnit.Count, 1);
      logger.info('zero results', { q: params.q, type: params.type, place: params.place });
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

function json(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}
