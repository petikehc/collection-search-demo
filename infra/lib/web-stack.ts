import { spawnSync } from 'node:child_process';
import { cpSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AssetHashType,
  CfnOutput,
  DockerImage,
  Duration,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import { AccessLogFormat } from 'aws-cdk-lib/aws-apigateway';
import {
  HttpApi,
  HttpStage,
  type IDomainName,
  LogGroupLogDestination,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import {
  Alarm,
  ComparisonOperator,
  type IMetric,
  TreatMissingData,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import {
  Architecture,
  Code,
  Function as LambdaFunction,
  LayerVersion,
  Runtime,
} from 'aws-cdk-lib/aws-lambda';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import type { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import type { ITopic } from 'aws-cdk-lib/aws-sns';
import type { Construct } from 'constructs';

const WEB_DIR = new URL('../../web/', import.meta.url).pathname;

/**
 * AWS Lambda Web Adapter v1.1.0 (awslabs/aws-lambda-web-adapter), published by AWS, pinned to
 * one layer version: it passes each request to the Astro server as plain HTTP.
 */
const WEB_ADAPTER_LAYER =
  'arn:aws:lambda:ap-southeast-2:753240598075:layer:LambdaAdapterLayerArm64:30';
const PORT = '8080';
/** Requests an hour to the site that are worth an email. */
export const SITE_TRAFFIC_ALARM_PER_HOUR = 20_000;

export interface WebStackProps extends StackProps {
  apiUrl: string;
  apiKeySecret: ISecret;
  userPoolId: string;
  loginBaseUrl: string;
  webClientSecret: ISecret;
  /** The kept custom domain (DomainStack). */
  domainName: IDomainName;
  alarmTopic: ITopic;
}

/**
 * The Astro web front end, hosted: its Node server runs in Lambda behind an HTTP API on the
 * custom domain (docs/adr/0013-hosting-the-web-front-end.md).
 */
export class WebStack extends Stack {
  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, { description: 'Collection search: hosted web front end', ...props });

    const fn = new LambdaFunction(this, 'WebFunction', {
      description: 'Astro web front end (server-rendered) behind the Lambda Web Adapter',
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      code: astroBuild(),
      handler: 'run.sh',
      layers: [LayerVersion.fromLayerVersionArn(this, 'WebAdapter', WEB_ADAPTER_LAYER)],
      memorySize: 1024,
      // Ask can take up to 28 s at the API; the HTTP API gives up at 30 s.
      timeout: Duration.seconds(30),
      // A ceiling on cost and on load passed to the API and the Museum.
      reservedConcurrentExecutions: 5,
      logGroup: new LogGroup(this, 'WebLogs'),
      environment: {
        AWS_LAMBDA_EXEC_WRAPPER: '/opt/bootstrap',
        PORT,
        // For Astro: listen on IPv4 loopback, where the adapter connects (`localhost` may
        // resolve to ::1). The adapter also reads HOST and logs a deprecation warning: expected.
        HOST: '127.0.0.1',
        // Ready once the port is open: an HTTP check of `/` would render a page (and search).
        AWS_LWA_READINESS_CHECK_PROTOCOL: 'tcp',
        NODE_ENV: 'production',
        // ARNs only: the server reads the secret values from Secrets Manager.
        API_URL: props.apiUrl,
        API_KEY_SECRET_ARN: props.apiKeySecret.secretArn,
        LOGIN_BASE_URL: props.loginBaseUrl,
        USER_POOL_ID: props.userPoolId,
        WEB_CLIENT_SECRET_ARN: props.webClientSecret.secretArn,
      },
    });
    props.apiKeySecret.grantRead(fn);
    props.webClientSecret.grantRead(fn);

    // Reachable only through the custom domain: the default execute-api URL is switched off.
    const api = new HttpApi(this, 'Site', {
      description: 'Collection search web front end',
      defaultIntegration: new HttpLambdaIntegration('Web', fn),
      disableExecuteApiEndpoint: true,
      createDefaultStage: false,
    });
    new HttpStage(this, 'Stage', {
      httpApi: api,
      stageName: '$default',
      autoDeploy: true,
      domainMapping: { domainName: props.domainName },
      throttle: { rateLimit: 20, burstLimit: 40 },
      accessLogSettings: {
        destination: new LogGroupLogDestination(new LogGroup(this, 'AccessLogs')),
        // HTTP API variables only. The path without its query string: no search terms logged.
        format: AccessLogFormat.custom(
          JSON.stringify({
            requestId: '$context.requestId',
            ip: '$context.identity.sourceIp',
            time: '$context.requestTime',
            method: '$context.httpMethod',
            path: '$context.path',
            status: '$context.status',
            // Who's crawling: the access logs showed tens of thousands of requests from two
            // addresses, with nothing to say what they were.
            userAgent: '$context.identity.userAgent',
            latencyMs: '$context.responseLatency',
            integrationLatencyMs: '$context.integrationLatency',
          }),
        ),
      },
    });

    const alarm = (id: string, description: string, metric: IMetric) =>
      new Alarm(this, id, {
        alarmDescription: description,
        metric,
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(new SnsAction(props.alarmTopic));
    alarm(
      'WebErrors',
      'The web front end Lambda failed (crash, timeout or failed start)',
      fn.metricErrors({ period: Duration.minutes(5), statistic: 'Sum' }),
    );
    alarm(
      'Site5xx',
      'The web front end returned server errors',
      api.metricServerError({ period: Duration.minutes(5), statistic: 'Sum' }),
    );

    // About ten times the busiest hour so far (a crawler, about 10,000 requests): an email
    // within the hour, rather than a budget alert hours later.
    new Alarm(this, 'SiteTraffic', {
      alarmDescription: 'Unusually heavy traffic to the web site: probably a crawler or a flood',
      metric: api.metricCount({ period: Duration.hours(1), statistic: 'Sum' }),
      threshold: SITE_TRAFFIC_ALARM_PER_HOUR,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new SnsAction(props.alarmTopic));

    new CfnOutput(this, 'SiteUrl', { value: `https://${props.domainName.name}` });
  }
}

/**
 * Builds the Astro server during synth, so `cdk deploy` always ships the current code, including
 * the shared code in functions/ it imports (hence the output hash, not a hash of web/). The build
 * bundles its dependencies (web/astro.config.ts), so the asset is just the build and a start
 * script for the Web Adapter.
 */
function astroBuild(): Code {
  return Code.fromAsset(WEB_DIR, {
    assetHashType: AssetHashType.OUTPUT,
    bundling: {
      // Never used: the build runs locally (tryBundle). CDK requires an image regardless.
      image: DockerImage.fromRegistry('public.ecr.aws/docker/library/node:24'),
      local: {
        tryBundle(outputDir) {
          const build = spawnSync('pnpm', ['--filter', 'web', 'build'], {
            stdio: 'inherit',
            env: { ...process.env, CI: '1' },
          });
          if (build.status !== 0) throw new Error('astro build failed');
          rmSync(join(outputDir, 'dist'), { recursive: true, force: true });
          cpSync(join(WEB_DIR, 'dist'), join(outputDir, 'dist'), { recursive: true });
          writeFileSync(join(outputDir, 'run.sh'), '#!/bin/sh\nexec node dist/server/entry.mjs\n', {
            mode: 0o755,
          });
          return true;
        },
      },
    },
  });
}
