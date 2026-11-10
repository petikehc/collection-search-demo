import { readFileSync } from 'node:fs';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiStack } from '../lib/api-stack.js';
import { SearchStack } from '../lib/search-stack.js';

const { context } = JSON.parse(readFileSync(new URL('../cdk.json', import.meta.url), 'utf8'));
const env = { account: '111111111111', region: 'ap-southeast-2' };

describe('ApiStack', () => {
  let template: Template;
  let spec: {
    paths: Record<string, { get: { security?: unknown[] } & Record<string, unknown> }>;
    security?: unknown[];
  };

  beforeAll(() => {
    const app = new App({ context });
    const search = new SearchStack(app, 'Search', { env });
    template = Template.fromStack(new ApiStack(app, 'Api', { env, search }));
    spec = Object.values(template.findResources('AWS::ApiGateway::RestApi'))[0]?.Properties.Body;
  });

  it('requires an API key for /search, but not for /health', () => {
    // API Gateway ignores an operation-level `security: []` override of a global requirement,
    // so the key is declared per operation instead.
    expect(spec.security).toBeUndefined();
    expect(spec.paths['/search']?.get.security).toEqual([{ apiKey: [] }]);
    expect(spec.paths['/health']?.get.security).toBeUndefined();
  });

  it('wires /search to the Lambda and /health to a mock', () => {
    expect(spec.paths['/search']?.get['x-amazon-apigateway-integration']).toMatchObject({
      type: 'aws_proxy',
    });
    expect(spec.paths['/health']?.get['x-amazon-apigateway-integration']).toMatchObject({
      type: 'mock',
    });
  });

  it('throttles the stage and limits each key with a usage plan', () => {
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      StageName: 'v1',
      TracingEnabled: true,
      MethodSettings: Match.arrayWith([
        Match.objectLike({ ThrottlingRateLimit: 10, ThrottlingBurstLimit: 20 }),
      ]),
    });
    template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
      Throttle: { RateLimit: 5, BurstLimit: 10 },
      Quota: { Limit: 5000, Period: 'DAY' },
    });
  });

  it('keeps the API key value out of the template', () => {
    const [key] = Object.values(template.findResources('AWS::ApiGateway::ApiKey'));
    expect(JSON.stringify(key?.Properties.Value)).toMatch(/resolve:secretsmanager/);
  });

  it('gives the search Lambda read-only access at both locks', () => {
    template.hasResourceProperties('Custom::OpenSearchRole', {
      RoleName: 'search_reader',
      ClusterPermissions: [],
      IndexPermissions: [{ index_patterns: ['objects', 'objects-*'], allowed_actions: ['read'] }],
    });
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ['es:ESHttpGet', 'es:ESHttpHead', 'es:ESHttpPost'],
            Resource: { 'Fn::Join': ['', [Match.anyValue(), '/objects/_search']] },
          }),
        ]),
      },
    });
  });
});
