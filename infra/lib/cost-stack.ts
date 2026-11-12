import { Stack, type StackProps } from 'aws-cdk-lib';
import { CfnAnomalyMonitor, CfnAnomalySubscription } from 'aws-cdk-lib/aws-ce';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { ALARM_EMAIL_PARAMETER } from './monitoring.js';

/** Unusual spend worth an email, in US dollars per day above the expected amount. */
export const ANOMALY_THRESHOLD_USD = 5;

/**
 * AWS Cost Anomaly Detection for the whole account (free): it learns the normal daily spend per
 * service and emails a daily summary when spend jumps by more than the threshold. Account-wide
 * on purpose: an unexpected cost can come from anywhere, not only this app's stacks.
 *
 * Kept by `pnpm teardown` (like Ci and Domain): the model needs about ten days of history to
 * learn what's normal, and starting again after every rebuild would leave it always learning.
 */
export class CostStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, { description: 'Collection search: cost anomaly alerts', ...props });

    const monitor = new CfnAnomalyMonitor(this, 'Services', {
      monitorName: 'collection-search-services',
      monitorType: 'DIMENSIONAL',
      monitorDimension: 'SERVICE',
    });

    new CfnAnomalySubscription(this, 'DailyEmail', {
      subscriptionName: 'collection-search-daily',
      monitorArnList: [monitor.attrMonitorArn],
      // Email needs a daily or weekly summary (immediate alerts go through SNS).
      frequency: 'DAILY',
      subscribers: [
        {
          type: 'EMAIL',
          address: StringParameter.valueForStringParameter(this, ALARM_EMAIL_PARAMETER),
        },
      ],
      thresholdExpression: JSON.stringify({
        Dimensions: {
          Key: 'ANOMALY_TOTAL_IMPACT_ABSOLUTE',
          MatchOptions: ['GREATER_THAN_OR_EQUAL'],
          Values: [String(ANOMALY_THRESHOLD_USD)],
        },
      }),
    });
  }
}
