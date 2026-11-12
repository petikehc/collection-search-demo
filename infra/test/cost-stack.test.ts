import { readFileSync } from 'node:fs';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { CostStack } from '../lib/cost-stack.js';

const { context } = JSON.parse(readFileSync(new URL('../cdk.json', import.meta.url), 'utf8'));
const env = { account: '111111111111', region: 'ap-southeast-2' };

describe('CostStack', () => {
  const template = Template.fromStack(new CostStack(new App({ context }), 'Costs', { env }));

  it('watches every service in the account for unusual spend', () => {
    template.hasResourceProperties('AWS::CE::AnomalyMonitor', {
      MonitorType: 'DIMENSIONAL',
      MonitorDimension: 'SERVICE',
    });
  });

  it('emails a daily summary of anomalies over $5, to the address in SSM', () => {
    const [sub] = Object.values(template.findResources('AWS::CE::AnomalySubscription'));
    expect(sub?.Properties).toMatchObject({
      Frequency: 'DAILY',
      Subscribers: [{ Type: 'EMAIL', Address: { Ref: expect.stringMatching(/alarmemail/) } }],
    });
    expect(JSON.parse(sub?.Properties.ThresholdExpression)).toEqual({
      Dimensions: {
        Key: 'ANOMALY_TOTAL_IMPACT_ABSOLUTE',
        MatchOptions: ['GREATER_THAN_OR_EQUAL'],
        Values: ['5'],
      },
    });
  });
});
