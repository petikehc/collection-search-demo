import { readFileSync } from 'node:fs';
import { Aws, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import {
  AccessLogFormat,
  ApiDefinition,
  EndpointType,
  LogGroupLogDestination,
  Period,
  SpecRestApi,
} from 'aws-cdk-lib/aws-apigateway';
import { type IRole, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Tracing } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';
import { parse } from 'yaml';
import { OBJECTS_ALIAS } from '../../functions/lib/search/constants.js';
import { LAMBDA_DEFAULTS } from './lambda-defaults.js';
import { FUNCTIONS_DIR, OpenSearchRole } from './opensearch-role.js';
import type { SearchStack } from './search-stack.js';

export const STAGE = 'v1';
const OPENAPI_FILE = new URL('../../openapi.yaml', import.meta.url);

export interface ApiStackProps extends StackProps {
  search: SearchStack;
}

/**
 * API Gateway REST API built from openapi.yaml (the contract), with the search Lambda behind it.
 * REST (not HTTP) API because usage plans, API keys and request validation are REST-only.
 */
export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, { description: 'Collection search: API Gateway and Lambdas', ...props });
    const { domain, adminRole, openSearchRoles } = props.search;

    const searchFn = new NodejsFunction(this, 'SearchFunction', {
      description: 'GET /search: queries the objects alias in OpenSearch',
      ...LAMBDA_DEFAULTS,
      entry: `${FUNCTIONS_DIR}search/handler.ts`,
      memorySize: 512,
      timeout: Duration.seconds(10),
      tracing: Tracing.ACTIVE,
      logGroup: new LogGroup(this, 'SearchLogs'),
      environment: {
        ...LAMBDA_DEFAULTS.environment,
        DOMAIN_ENDPOINT: domain.domainEndpoint,
        POWERTOOLS_SERVICE_NAME: 'search',
        POWERTOOLS_METRICS_NAMESPACE: 'CollectionSearch',
      },
    });

    // Read-only at both locks: IAM allows only searches on the alias, FGAC allows only `read`.
    new OpenSearchRole(this, 'SearchReaderRole', {
      provider: openSearchRoles,
      domain,
      adminRole,
      roleName: 'search_reader',
      backendRoles: [searchFn.role as IRole],
      indexPermissions: [
        { indexPatterns: [OBJECTS_ALIAS, `${OBJECTS_ALIAS}-*`], allowedActions: ['read'] },
      ],
      httpAccess: {
        actions: ['es:ESHttpGet', 'es:ESHttpHead', 'es:ESHttpPost'],
        paths: [`${OBJECTS_ALIAS}/_search`],
      },
    });

    const api = new SpecRestApi(this, 'Api', {
      restApiName: 'collection-search',
      apiDefinition: ApiDefinition.fromInline(withIntegrations(searchFn.functionArn)),
      endpointTypes: [EndpointType.REGIONAL],
      // Account-level role that lets API Gateway write logs to CloudWatch (none was set).
      cloudWatchRole: true,
      cloudWatchRoleRemovalPolicy: RemovalPolicy.DESTROY,
      deployOptions: {
        stageName: STAGE,
        // Stage-wide ceiling across all callers; the usage plan below limits each API key.
        throttlingRateLimit: 10,
        throttlingBurstLimit: 20,
        tracingEnabled: true,
        accessLogDestination: new LogGroupLogDestination(new LogGroup(this, 'AccessLogs')),
        accessLogFormat: AccessLogFormat.jsonWithStandardFields(),
      },
    });

    searchFn.addPermission('InvokeFromApi', {
      principal: new ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: api.arnForExecuteApi('GET', '/search', STAGE),
    });

    // The key the Astro server sends. Generated into Secrets Manager; the template only holds
    // a {{resolve:secretsmanager:…}} reference, never the value.
    const keySecret = new Secret(this, 'WebApiKey', {
      description: 'API key for the collection search web front end',
      generateSecretString: { passwordLength: 40, excludePunctuation: true },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const key = api.addApiKey('WebKey', { value: keySecret.secretValue.unsafeUnwrap() });
    const plan = api.addUsagePlan('WebPlan', {
      description: 'Web front end: per-key throttle and daily quota',
      throttle: { rateLimit: 5, burstLimit: 10 },
      quota: { limit: 5000, period: Period.DAY },
    });
    plan.addApiKey(key);
    plan.addApiStage({ stage: api.deploymentStage });

    new CfnOutput(this, 'ApiUrl', { value: api.url });
    new CfnOutput(this, 'ApiKeySecretArn', { value: keySecret.secretArn });
    new CfnOutput(this, 'SearchFunctionName', { value: searchFn.functionName });
  }
}

/**
 * openapi.yaml stays a plain contract; the AWS-specific integration details are added here,
 * where the Lambda ARN is known.
 */
function withIntegrations(searchFunctionArn: string) {
  const spec = parse(readFileSync(OPENAPI_FILE, 'utf8'));

  // API Gateway can check required parameters before invoking the Lambda (types and ranges are
  // still validated in the Lambda; the REST validator doesn't check those).
  spec['x-amazon-apigateway-request-validators'] = {
    params: { validateRequestParameters: true, validateRequestBody: false },
  };

  spec.paths['/search'].get['x-amazon-apigateway-request-validator'] = 'params';
  spec.paths['/search'].get['x-amazon-apigateway-integration'] = {
    type: 'aws_proxy',
    httpMethod: 'POST',
    uri: `arn:${Aws.PARTITION}:apigateway:${Aws.REGION}:lambda:path/2015-03-31/functions/${searchFunctionArn}/invocations`,
  };

  // Answered by API Gateway itself: no Lambda, no cost beyond the request.
  spec.paths['/health'].get['x-amazon-apigateway-integration'] = {
    type: 'mock',
    requestTemplates: { 'application/json': '{"statusCode": 200}' },
    responses: {
      default: {
        statusCode: '200',
        responseTemplates: { 'application/json': '{"status":"ok"}' },
      },
    },
  };
  return spec;
}
