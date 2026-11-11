import { readFileSync } from 'node:fs';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { AiStack } from '../lib/ai-stack.js';
import { ApiStack } from '../lib/api-stack.js';
import { SearchStack } from '../lib/search-stack.js';

const { context } = JSON.parse(readFileSync(new URL('../cdk.json', import.meta.url), 'utf8'));
const env = { account: '111111111111', region: 'ap-southeast-2' };

const build = () => {
  const app = new App({ context });
  const search = new SearchStack(app, 'Search', { env });
  const ai = new AiStack(app, 'Ai', { env, search });
  return {
    api: Template.fromStack(new ApiStack(app, 'Api', { env, search, ai })),
    ai: Template.fromStack(ai),
  };
};

describe('Monitoring', () => {
  const { api, ai } = build();

  it('emails alarms to an address read from SSM at deploy time (never in the template or repo)', () => {
    const [sub] = Object.values(api.findResources('AWS::SNS::Subscription'));
    expect(sub?.Properties.Protocol).toBe('email');
    // A reference to an SSM-typed stack parameter, not a literal address.
    expect(sub?.Properties.Endpoint).toEqual({ Ref: expect.stringMatching(/^SsmParameterValue/) });
  });

  it('alarms on errors, slow or unusual Ask use, and OpenSearch health, all to the topic', () => {
    const alarms = Object.values(api.findResources('AWS::CloudWatch::Alarm'));
    expect(alarms).toHaveLength(10);
    for (const a of alarms) expect(a.Properties.AlarmActions).toHaveLength(1);
  });

  it('keeps the JVM memory pressure alarm at 80% over 15 minutes', () => {
    api.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'JVMMemoryPressure',
      Threshold: 80,
      EvaluationPeriods: 3,
      Period: 300,
    });
  });

  it('alarms within the hour on unusual Ask volume (budgets alert hours later)', () => {
    api.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'AskRequests',
      Threshold: 60,
      Period: 3600,
    });
  });

  it('counts detect-only sacred-knowledge detections from the invocation logs', () => {
    ai.hasResourceProperties('AWS::Logs::MetricFilter', {
      FilterPattern: Match.stringLikeRegexp('Secret or sacred cultural knowledge'),
      MetricTransformations: [
        Match.objectLike({
          MetricName: 'SacredTopicDetections',
          MetricNamespace: 'CollectionSearch',
        }),
      ],
    });
  });

  it('has one dashboard', () => {
    api.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
  });
});
