import { readFileSync } from 'node:fs';
import { App, type Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../lib/app.js';

const { context } = JSON.parse(readFileSync(new URL('../cdk.json', import.meta.url), 'utf8'));

describe('WebStack', () => {
  // No bundling: unit tests don't need an Astro build (`pnpm synth` runs it).
  const app = buildApp(new App({ context: { ...context, 'aws:cdk:bundling-stacks': [] } }));
  const template = Template.fromStack(app.node.findChild('CollectionSearch-Web') as Stack);
  const [fn] = Object.values(template.findResources('AWS::Lambda::Function'));
  const env = fn?.Properties.Environment.Variables ?? {};

  it('runs the Astro server through one pinned version of the Lambda Web Adapter', () => {
    expect(fn?.Properties).toMatchObject({
      Runtime: 'nodejs24.x',
      Architectures: ['arm64'],
      Handler: 'run.sh',
      Layers: ['arn:aws:lambda:ap-southeast-2:753240598075:layer:LambdaAdapterLayerArm64:30'],
      ReservedConcurrentExecutions: 5,
      Timeout: 30,
    });
    expect(env).toMatchObject({ AWS_LAMBDA_EXEC_WRAPPER: '/opt/bootstrap', PORT: '8080' });
  });

  it('gets secret ARNs, never secret values, and may read only those two secrets', () => {
    expect(Object.keys(env)).toEqual(
      expect.arrayContaining(['API_KEY_SECRET_ARN', 'WEB_CLIENT_SECRET_ARN']),
    );
    expect(JSON.stringify(env)).not.toMatch(/resolve:secretsmanager|SecretString/);

    const statements = Object.values(template.findResources('AWS::IAM::Policy')).flatMap(
      (p) => p.Properties.PolicyDocument.Statement,
    );
    // CDK merges the two grants into one statement on the two secrets.
    expect(statements).toHaveLength(1);
    expect(statements[0].Action).toEqual([
      'secretsmanager:DescribeSecret',
      'secretsmanager:GetSecretValue',
    ]);
    expect(statements[0].Resource).toHaveLength(2);
    expect(JSON.stringify(statements[0].Resource)).not.toContain('*');
  });

  it('is reachable only through the custom domain, with throttling and access logs', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      ProtocolType: 'HTTP',
      DisableExecuteApiEndpoint: true,
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default',
      DefaultRouteSettings: { ThrottlingRateLimit: 20, ThrottlingBurstLimit: 40 },
      AccessLogSettings: { DestinationArn: Match.anyValue(), Format: Match.anyValue() },
    });
    template.resourceCountIs('AWS::ApiGatewayV2::ApiMapping', 1);
  });

  it('logs request paths but not query strings (no search terms)', () => {
    const [stage] = Object.values(template.findResources('AWS::ApiGatewayV2::Stage'));
    const format = stage?.Properties.AccessLogSettings.Format;
    expect(format).toContain('$context.path');
    expect(format).toContain('$context.identity.userAgent');
    expect(format).not.toMatch(/querystring|routeKey/i);
  });

  it('alarms on Lambda errors, server errors and heavy traffic, to the app alarm topic', () => {
    const alarms = Object.values(template.findResources('AWS::CloudWatch::Alarm'));
    expect(alarms.map((a) => a.Properties.MetricName).sort()).toEqual(['5xx', 'Count', 'Errors']);
    const traffic = alarms.find((a) => a.Properties.MetricName === 'Count');
    expect(traffic?.Properties).toMatchObject({ Period: 3600, Threshold: 20_000 });
    for (const a of alarms) expect(a.Properties.AlarmActions).toHaveLength(1);
  });
});
