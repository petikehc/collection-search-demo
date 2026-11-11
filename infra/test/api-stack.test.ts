import { readFileSync } from 'node:fs';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { AiStack } from '../lib/ai-stack.js';
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
    const ai = new AiStack(app, 'Ai', { env, search });
    template = Template.fromStack(new ApiStack(app, 'Api', { env, search, ai }));
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

describe('ApiStack /ask', () => {
  const app = new App({ context });
  const search = new SearchStack(app, 'Search', { env });
  const ai = new AiStack(app, 'Ai', { env, search });
  const template = Template.fromStack(new ApiStack(app, 'Api', { env, search, ai }));
  const spec = Object.values(template.findResources('AWS::ApiGateway::RestApi'))[0]?.Properties
    .Body;

  it('requires a SigV4-signed request and validates the body before the Lambda runs', () => {
    expect(spec.paths['/ask'].post.security).toEqual([{ sigv4: [] }]);
    expect(spec.paths['/ask'].post['x-amazon-apigateway-request-validator']).toBe('body');
  });

  it('caps parallel model calls with reserved concurrency and a strict method throttle', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Description: Match.stringLikeRegexp('POST /ask'),
      ReservedConcurrentExecutions: 2,
    });
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      MethodSettings: Match.arrayWith([
        Match.objectLike({
          ResourcePath: '/~1ask',
          HttpMethod: 'POST',
          ThrottlingRateLimit: 1,
          ThrottlingBurstLimit: 2,
        }),
      ]),
    });
  });

  it('may invoke only the Australian inference profile and its Sydney and Melbourne models', () => {
    const policies = JSON.stringify(template.findResources('AWS::IAM::Policy'));
    expect(policies).toContain('inference-profile/au.anthropic.claude-haiku-4-5');
    expect(policies).toContain('ap-southeast-2::foundation-model/anthropic.claude-haiku-4-5');
    expect(policies).toContain('ap-southeast-4::foundation-model/anthropic.claude-haiku-4-5');
    expect(policies).not.toMatch(/foundation-model\/\*/);
  });
});

describe('ApiStack guardrail', () => {
  const app = new App({ context });
  const search = new SearchStack(app, 'Search', { env });
  const ai = new AiStack(app, 'Ai', { env, search });
  const template = Template.fromStack(new ApiStack(app, 'Api', { env, search, ai }));
  const [guardrail] = Object.values(template.findResources('AWS::Bedrock::Guardrail'));
  const props = guardrail?.Properties;

  it('blocks prompt attacks on input and checks violence only lightly on output', () => {
    expect(props.ContentPolicyConfig.FiltersConfig).toEqual(
      expect.arrayContaining([
        { Type: 'PROMPT_ATTACK', InputStrength: 'HIGH', OutputStrength: 'NONE' },
        { Type: 'VIOLENCE', InputStrength: 'MEDIUM', OutputStrength: 'LOW' },
      ]),
    );
  });

  it('denies valuation and secret or sacred cultural knowledge', () => {
    const names = props.TopicPolicyConfig.TopicsConfig.map((t: { Name: string }) => t.Name);
    expect(names).toEqual(['Object valuation', 'Secret or sacred cultural knowledge']);
  });

  it('checks denied topics on input only (answers come from published records)', () => {
    for (const topic of props.TopicPolicyConfig.TopicsConfig) {
      expect(topic).toMatchObject({ InputEnabled: true, OutputEnabled: false });
      expect(topic.Definition.length).toBeLessThanOrEqual(200); // Classic tier limit
    }
  });

  it('blocks valuation requests but only detects the sacred-knowledge topic', () => {
    const [valuation, sacred] = props.TopicPolicyConfig.TopicsConfig;
    expect(valuation).toMatchObject({ Name: 'Object valuation', InputAction: 'BLOCK' });
    expect(sacred).toMatchObject({
      Name: 'Secret or sacred cultural knowledge',
      InputAction: 'NONE',
    });
  });

  it('masks contact details but never names (historical people are the collection)', () => {
    const types = props.SensitiveInformationPolicyConfig.PiiEntitiesConfig.map(
      (p: { Type: string }) => p.Type,
    );
    expect(types).toContain('EMAIL');
    expect(types).not.toContain('NAME');
  });

  it('checks grounding and relevance of answers', () => {
    expect(props.ContextualGroundingPolicyConfig.FiltersConfig).toEqual([
      { Type: 'GROUNDING', Threshold: 0.5 },
      { Type: 'RELEVANCE', Threshold: 0.2 },
    ]);
  });

  it('publishes a version whose description tracks the configuration', () => {
    template.hasResourceProperties('AWS::Bedrock::GuardrailVersion', {
      Description: Match.stringLikeRegexp('^Ask endpoint, config [0-9a-f]{12}$'),
    });
  });
});
