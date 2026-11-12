import { Duration } from 'aws-cdk-lib';
import type { RestApiBase } from 'aws-cdk-lib/aws-apigateway';
import {
  Alarm,
  ComparisonOperator,
  Dashboard,
  GraphWidget,
  type IMetric,
  Metric,
  SingleValueWidget,
  TextWidget,
  TreatMissingData,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import type { Domain } from 'aws-cdk-lib/aws-opensearchservice';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface MonitoringProps {
  api: RestApiBase;
  searchFn: IFunction;
  askFn: IFunction;
  bookmarksFn: IFunction;
  ingestFn: IFunction;
  domain: Domain;
  /** Inference profile ID the ask Lambda uses; Bedrock reports its metrics under it. */
  askModelId: string;
  metricsNamespace: string;
}

/**
 * SSM parameter holding the alarm email address. Created once, outside the code, so the address
 * isn't in the repository and every deploy (local or CI) keeps the subscription:
 *   aws ssm put-parameter --name /collection-search/alarm-email --type String --value you@example.org
 */
export const ALARM_EMAIL_PARAMETER = '/collection-search/alarm-email';

/**
 * Alarms (emailed through SNS) and one dashboard for the whole app. Alarm thresholds suit a
 * low-traffic demo: one failure is worth knowing about; "unusual" means unusual for a single user.
 */
export class Monitoring extends Construct {
  readonly topic: Topic;
  readonly alarms: Alarm[] = [];

  constructor(scope: Construct, id: string, props: MonitoringProps) {
    super(scope, id);
    const { api, searchFn, askFn, bookmarksFn, ingestFn, domain } = props;

    this.topic = new Topic(this, 'AlarmTopic', { displayName: 'Collection search alarms' });
    // Resolved by CloudFormation at deploy time; the deploy fails if the parameter is missing,
    // rather than quietly dropping the subscription.
    this.topic.addSubscription(
      new EmailSubscription(StringParameter.valueForStringParameter(this, ALARM_EMAIL_PARAMETER)),
    );

    const custom = (metricName: string, service?: string, period = Duration.minutes(5)) =>
      new Metric({
        namespace: props.metricsNamespace,
        metricName,
        dimensionsMap: service ? { service } : undefined,
        statistic: 'Sum',
        period,
      });
    const bedrock = (metricName: string, statistic = 'Sum') =>
      new Metric({
        namespace: 'AWS/Bedrock',
        metricName,
        dimensionsMap: { ModelId: props.askModelId },
        statistic,
        period: Duration.minutes(5),
      });

    const fiveMin = { period: Duration.minutes(5) };
    const alarm = (
      name: string,
      metric: IMetric,
      threshold: number,
      description: string,
      opts: { comparison?: ComparisonOperator; periods?: number } = {},
    ) => {
      const a = new Alarm(this, name, {
        alarmDescription: description,
        metric,
        threshold,
        evaluationPeriods: opts.periods ?? 1,
        comparisonOperator:
          opts.comparison ?? ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        // No traffic means no data: that's normal for a demo, not a failure.
        treatMissingData: TreatMissingData.NOT_BREACHING,
      });
      a.addAlarmAction(new SnsAction(this.topic));
      this.alarms.push(a);
      return a;
    };

    alarm(
      'Api5xx',
      api.metricServerError({ ...fiveMin, statistic: 'Sum' }),
      1,
      'The API returned server errors (5xx) to callers',
    );
    for (const [name, fn] of [
      ['SearchErrors', searchFn],
      ['AskErrors', askFn],
      ['BookmarksErrors', bookmarksFn],
      ['IngestErrors', ingestFn],
    ] as const) {
      alarm(
        name,
        fn.metricErrors({ ...fiveMin, statistic: 'Sum' }),
        1,
        `${name.replace('Errors', '')} Lambda failed (unhandled error or crash)`,
      );
    }
    alarm(
      'AskSlow',
      askFn.metricDuration({ ...fiveMin, statistic: 'p90' }),
      15_000,
      'Ask answers are slow (p90 over 15 s; API Gateway gives up at 29 s)',
    );
    alarm(
      'AskVolume',
      custom('AskRequests', 'ask', Duration.hours(1)),
      60,
      'Unusually many Ask requests in an hour: each one costs money, and budgets alert hours later',
    );
    alarm(
      'AskCapReached',
      custom('AskCapReached', 'ask', Duration.hours(1)),
      1,
      "Today's allowance of AI answers is used up: visitors are being turned away until tomorrow",
    );
    alarm(
      'GuardrailInterventions',
      custom('GuardrailInterventions', 'ask', Duration.hours(1)),
      10,
      'Many guardrail blocks in an hour: possible abuse, or a change that over-blocks',
    );
    alarm(
      'ClusterRed',
      domain.metricClusterStatusRed({ period: Duration.minutes(1) }),
      1,
      'OpenSearch cluster is red: some data is unavailable',
    );
    alarm(
      'JvmMemoryPressure',
      domain.metricJVMMemoryPressure({ ...fiveMin, statistic: 'Maximum' }),
      80,
      'OpenSearch JVM memory pressure above 80% for 15 minutes',
      { comparison: ComparisonOperator.GREATER_THAN_THRESHOLD, periods: 3 },
    );
    alarm(
      'LowStorage',
      domain.metricFreeStorageSpace({ ...fiveMin, statistic: 'Minimum' }),
      2048,
      'OpenSearch free storage below 2 GB (a reindex briefly needs room for two copies)',
      { comparison: ComparisonOperator.LESS_THAN_THRESHOLD },
    );

    const dashboard = new Dashboard(this, 'Dashboard', {
      dashboardName: 'collection-search',
      defaultInterval: Duration.hours(24),
    });
    const graph = (title: string, metrics: IMetric[], right: IMetric[] = []) =>
      new GraphWidget({ title, left: metrics, right, width: 8, height: 6 });

    dashboard.addWidgets(
      new TextWidget({
        markdown:
          '# Collection search\nSearch API, Ask (Bedrock RAG with a guardrail) and the OpenSearch domain. Alarms are emailed via SNS.',
        width: 24,
        height: 2,
      }),
    );
    dashboard.addWidgets(
      graph('API requests and errors', [
        api.metricCount(fiveMin),
        api.metricClientError(fiveMin),
        api.metricServerError(fiveMin),
      ]),
      graph('API latency (p90)', [api.metricLatency({ ...fiveMin, statistic: 'p90' })]),
      graph('Lambda duration (p90)', [
        searchFn.metricDuration({ ...fiveMin, statistic: 'p90' }),
        askFn.metricDuration({ ...fiveMin, statistic: 'p90' }),
      ]),
    );
    dashboard.addWidgets(
      graph('Searches', [custom('Searches', 'search'), custom('ZeroResultSearches', 'search')]),
      graph('Ask', [
        custom('AskRequests', 'ask'),
        custom('GuardrailInterventions', 'ask'),
        custom('SacredTopicDetections'),
      ]),
      graph('Bedrock tokens (Haiku 4.5, au.)', [
        bedrock('InputTokenCount'),
        bedrock('OutputTokenCount'),
      ]),
    );
    dashboard.addWidgets(
      graph('OpenSearch JVM memory pressure and CPU', [
        domain.metricJVMMemoryPressure(fiveMin),
        domain.metricCPUUtilization(fiveMin),
      ]),
      graph(
        'OpenSearch search latency and rate',
        [domain.metricSearchLatency(fiveMin)],
        [
          new Metric({
            namespace: 'AWS/ES',
            metricName: 'SearchRate',
            dimensionsMap: { DomainName: domain.domainName, ClientId: domain.stack.account },
            ...fiveMin,
          }),
        ],
      ),
      new SingleValueWidget({
        title: 'OpenSearch free storage (MB) and cluster red',
        metrics: [
          domain.metricFreeStorageSpace({ ...fiveMin, statistic: 'Minimum' }),
          domain.metricClusterStatusRed(fiveMin),
        ],
        width: 8,
        height: 6,
      }),
    );
  }
}
