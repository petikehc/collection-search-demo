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
import type { IUserPool } from 'aws-cdk-lib/aws-cognito';
import { AttributeType, TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { type IRole, PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Tracing } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import type { Topic } from 'aws-cdk-lib/aws-sns';
import type { Construct } from 'constructs';
import { parse } from 'yaml';
import { OBJECTS_ALIAS } from '../../functions/lib/search/constants.js';
import { type AiStack, METRICS_NAMESPACE } from './ai-stack.js';
import { AskGuardrail } from './guardrail.js';
import { LAMBDA_DEFAULTS } from './lambda-defaults.js';
import { Monitoring } from './monitoring.js';
import { FUNCTIONS_DIR, OpenSearchRole } from './opensearch-role.js';
import { embeddingModelArn, type SearchStack } from './search-stack.js';

export const STAGE = 'v1';

/** Haiku 4.5 through the Australian cross-region inference profile: Sydney and Melbourne only. */
export const ASK_PROFILE_ID = 'au.anthropic.claude-haiku-4-5-20251001-v1:0';
const ASK_FOUNDATION_MODEL = 'anthropic.claude-haiku-4-5-20251001-v1:0';
const ASK_PROFILE_REGIONS = ['ap-southeast-2', 'ap-southeast-4'];
const OPENAPI_FILE = new URL('../../openapi.yaml', import.meta.url);

export interface ApiStackProps extends StackProps {
  search: SearchStack;
  ai: AiStack;
  /** Signs users in for /ask and /favourites. */
  userPool: IUserPool;
}

/**
 * API Gateway REST API built from openapi.yaml (the contract), with the search and ask Lambdas.
 * REST (not HTTP) API because usage plans, API keys and request validation are REST-only.
 */
export class ApiStack extends Stack {
  /** For the hosted web front end (WebStack). */
  readonly apiUrl: string;
  readonly apiKeySecret: Secret;
  readonly alarmTopic: Topic;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, { description: 'Collection search: API Gateway and Lambdas', ...props });
    const { domain, adminRole, openSearchRoles } = props.search;
    const { knowledgeBase } = props.ai;

    // Owned here, next to its only user: each guardrail change publishes a new version, and a
    // value exported from another stack can't change while this stack imports it.
    const guardrail = new AskGuardrail(this, 'AskGuardrail');

    const searchFn = new NodejsFunction(this, 'SearchFunction', {
      description: 'GET /search: hybrid keyword and vector search over the objects alias',
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

    // Embeds the query for hybrid search: this one model, in this region, nothing else.
    searchFn.addToRolePolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [embeddingModelArn(this)],
      }),
    );

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

    // POST /ask: RetrieveAndGenerate with the guardrail. Every call costs money, so reserved
    // concurrency is a hard ceiling on parallel model calls (API Gateway throttles are best effort).
    const askProfileArn = this.formatArn({
      service: 'bedrock',
      resource: 'inference-profile',
      resourceName: ASK_PROFILE_ID,
    });
    const askFn = new NodejsFunction(this, 'AskFunction', {
      description: 'POST /ask: RAG over the collection with the guardrail applied',
      ...LAMBDA_DEFAULTS,
      entry: `${FUNCTIONS_DIR}ask/handler.ts`,
      memorySize: 512,
      timeout: Duration.seconds(28), // just under API Gateway's 29-second integration limit
      reservedConcurrentExecutions: 2,
      tracing: Tracing.ACTIVE,
      logGroup: new LogGroup(this, 'AskLogs'),
      environment: {
        ...LAMBDA_DEFAULTS.environment,
        KNOWLEDGE_BASE_ID: knowledgeBase.attrKnowledgeBaseId,
        MODEL_ARN: askProfileArn,
        GUARDRAIL_ID: guardrail.guardrailId,
        GUARDRAIL_VERSION: guardrail.version,
        POWERTOOLS_SERVICE_NAME: 'ask',
        POWERTOOLS_METRICS_NAMESPACE: 'CollectionSearch',
      },
    });
    // RetrieveAndGenerate has no resource type; the calls it makes are each scoped below.
    askFn.addToRolePolicy(
      new PolicyStatement({ actions: ['bedrock:RetrieveAndGenerate'], resources: ['*'] }),
    );
    askFn.addToRolePolicy(
      new PolicyStatement({
        actions: ['bedrock:Retrieve'],
        resources: [knowledgeBase.attrKnowledgeBaseArn],
      }),
    );
    // An inference profile needs permission on the profile and on the model in each of its regions.
    askFn.addToRolePolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:GetInferenceProfile'],
        resources: [
          askProfileArn,
          ...ASK_PROFILE_REGIONS.map(
            (region) =>
              `arn:${Aws.PARTITION}:bedrock:${region}::foundation-model/${ASK_FOUNDATION_MODEL}`,
          ),
        ],
      }),
    );
    askFn.addToRolePolicy(
      new PolicyStatement({
        actions: ['bedrock:ApplyGuardrail'],
        resources: [guardrail.guardrailArn],
      }),
    );

    // Favourites: one partition per user. On-demand billing: nothing is charged while idle.
    const favouritesTable = new TableV2(this, 'Favourites', {
      partitionKey: { name: 'sub', type: AttributeType.STRING },
      sortKey: { name: 'objectId', type: AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const favouritesFn = new NodejsFunction(this, 'FavouritesFunction', {
      description: "/favourites: the signed-in user's favourite objects in DynamoDB",
      ...LAMBDA_DEFAULTS,
      entry: `${FUNCTIONS_DIR}favourites/handler.ts`,
      memorySize: 256,
      timeout: Duration.seconds(5),
      tracing: Tracing.ACTIVE,
      logGroup: new LogGroup(this, 'FavouritesLogs'),
      environment: {
        ...LAMBDA_DEFAULTS.environment,
        TABLE_NAME: favouritesTable.tableName,
        POWERTOOLS_SERVICE_NAME: 'favourites',
      },
    });
    // Only the three calls the handler makes; no Scan, so the function can't list other users.
    favouritesTable.grant(
      favouritesFn,
      'dynamodb:Query',
      'dynamodb:PutItem',
      'dynamodb:DeleteItem',
    );

    const api = new SpecRestApi(this, 'Api', {
      restApiName: 'collection-search',
      apiDefinition: ApiDefinition.fromInline(
        withIntegrations(
          {
            search: searchFn.functionArn,
            ask: askFn.functionArn,
            favourites: favouritesFn.functionArn,
          },
          props.userPool.userPoolArn,
        ),
      ),
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
        // /ask calls a model on every request: a much lower limit than the stage default.
        methodOptions: { '/ask/POST': { throttlingRateLimit: 1, throttlingBurstLimit: 2 } },
      },
    });

    searchFn.addPermission('InvokeFromApi', {
      principal: new ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: api.arnForExecuteApi('GET', '/search', STAGE),
    });
    askFn.addPermission('InvokeFromApi', {
      principal: new ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: api.arnForExecuteApi('POST', '/ask', STAGE),
    });
    favouritesFn.addPermission('InvokeFromApi', {
      principal: new ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: api.arnForExecuteApi('*', '/favourites*', STAGE),
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

    const monitoring = new Monitoring(this, 'Monitoring', {
      api,
      searchFn,
      askFn,
      favouritesFn,
      ingestFn: props.search.ingestFn,
      domain,
      askModelId: ASK_PROFILE_ID,
      metricsNamespace: METRICS_NAMESPACE,
    });

    this.apiUrl = api.url;
    this.apiKeySecret = keySecret;
    this.alarmTopic = monitoring.topic;

    new CfnOutput(this, 'ApiUrl', { value: api.url });
    new CfnOutput(this, 'AlarmTopicArn', { value: monitoring.topic.topicArn });
    new CfnOutput(this, 'ApiKeySecretArn', { value: keySecret.secretArn });
    new CfnOutput(this, 'SearchFunctionName', { value: searchFn.functionName });
    new CfnOutput(this, 'FavouritesTableName', { value: favouritesTable.tableName });
    new CfnOutput(this, 'AskModelArn', { value: askProfileArn });
    new CfnOutput(this, 'GuardrailId', { value: guardrail.guardrailId });
    new CfnOutput(this, 'GuardrailVersion', { value: guardrail.version });
  }
}

/**
 * openapi.yaml stays a plain contract; the AWS-specific integration details are added here,
 * where the Lambda ARN is known.
 */
function withIntegrations(
  functionArns: { search: string; ask: string; favourites: string },
  userPoolArn: string,
) {
  const spec = parse(readFileSync(OPENAPI_FILE, 'utf8'));
  const lambdaProxy = (functionArn: string) => ({
    type: 'aws_proxy',
    httpMethod: 'POST',
    uri: `arn:${Aws.PARTITION}:apigateway:${Aws.REGION}:lambda:path/2015-03-31/functions/${functionArn}/invocations`,
  });

  // API Gateway can check required parameters before invoking the Lambda (types and ranges are
  // still validated in the Lambda; the REST validator doesn't check those).
  // The `cognito` scheme checks access tokens from this user pool: signature, expiry, and the
  // scope each operation lists. A valid token without that scope is refused.
  spec.components.securitySchemes.cognito['x-amazon-apigateway-authorizer'] = {
    type: 'cognito_user_pools',
    providerARNs: [userPoolArn],
  };

  spec['x-amazon-apigateway-request-validators'] = {
    params: { validateRequestParameters: true, validateRequestBody: false },
    body: { validateRequestParameters: false, validateRequestBody: true },
  };

  spec.paths['/search'].get['x-amazon-apigateway-request-validator'] = 'params';
  spec.paths['/search'].get['x-amazon-apigateway-integration'] = lambdaProxy(functionArns.search);

  // Request bodies are checked against the AskRequest schema before the Lambda (and a model) runs.
  spec.paths['/ask'].post['x-amazon-apigateway-request-validator'] = 'body';
  spec.paths['/ask'].post['x-amazon-apigateway-integration'] = lambdaProxy(functionArns.ask);

  const favourites = lambdaProxy(functionArns.favourites);
  spec.paths['/favourites'].get['x-amazon-apigateway-integration'] = favourites;
  spec.paths['/favourites/{objectId}'].put['x-amazon-apigateway-request-validator'] = 'body';
  spec.paths['/favourites/{objectId}'].put['x-amazon-apigateway-integration'] = favourites;
  spec.paths['/favourites/{objectId}'].delete['x-amazon-apigateway-integration'] = favourites;

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
