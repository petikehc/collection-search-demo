import { type IAspect, RemovalPolicy } from 'aws-cdk-lib';
import { CfnLogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { IConstruct } from 'constructs';

/**
 * Caps retention and deletes every log group with its stack, including the ones CDK creates
 * implicitly for custom resources (which default to 731 days and are retained on delete).
 * Without this, teardown leaves log groups behind.
 */
export class LogGroupDefaults implements IAspect {
  constructor(private readonly maxRetention = RetentionDays.TWO_WEEKS) {}

  visit(node: IConstruct): void {
    if (!(node instanceof CfnLogGroup)) return;
    if (node.retentionInDays === undefined || node.retentionInDays > this.maxRetention) {
      node.retentionInDays = this.maxRetention;
    }
    node.applyRemovalPolicy(RemovalPolicy.DESTROY);
  }
}
