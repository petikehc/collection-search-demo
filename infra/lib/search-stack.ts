import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps, TimeZone } from 'aws-cdk-lib';
import { EbsDeviceVolumeType } from 'aws-cdk-lib/aws-ec2';
import { AccountRootPrincipal, type IRole, PolicyStatement, Role } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import {
  Domain,
  EngineVersion,
  IpAddressType,
  TLSSecurityPolicy,
} from 'aws-cdk-lib/aws-opensearchservice';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { Schedule, ScheduleExpression } from 'aws-cdk-lib/aws-scheduler';
import { LambdaInvoke } from 'aws-cdk-lib/aws-scheduler-targets';
import type { Construct } from 'constructs';
import { KB_PREFIX } from '../../functions/lib/kb/documents.js';
import { OBJECTS_ALIAS } from '../../functions/lib/search/constants.js';
import { LAMBDA_DEFAULTS } from './lambda-defaults.js';
import { FUNCTIONS_DIR, OpenSearchRole, OpenSearchRoleProvider } from './opensearch-role.js';

export const DOMAIN_NAME = 'collection-search';
export const DATA_NODE_INSTANCE_TYPE = 'm7g.medium.search';

/**
 * The OpenSearch Service domain used for keyword search and as the Knowledge Base vector store.
 * See docs/adr/0002 (managed domain and sizing) and 0003 (public endpoint with fine-grained access control).
 */
export class SearchStack extends Stack {
  readonly domain: Domain;
  /** The fine-grained access control master user. Only this role can change OpenSearch security config. */
  readonly adminRole: Role;
  /** Reused by other stacks to map their IAM roles to OpenSearch roles. */
  readonly openSearchRoles: OpenSearchRoleProvider;
  /** Knowledge Base source documents, written by the ingest under kb/. */
  readonly docsBucket: Bucket;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, { description: 'Collection search: OpenSearch domain and ingest', ...props });

    // Trusts the account, so only principals that are also allowed sts:AssumeRole on it by
    // their own IAM policy (admins, and later the bootstrap Lambda) can use it.
    this.adminRole = new Role(this, 'OpenSearchAdminRole', {
      assumedBy: new AccountRootPrincipal(),
      description: 'Fine-grained access control master user for the collection search domain',
    });

    const appLogs = new LogGroup(this, 'AppLogs', {
      retention: RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const slowSearchLogs = new LogGroup(this, 'SlowSearchLogs', {
      retention: RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.domain = new Domain(this, 'Domain', {
      domainName: DOMAIN_NAME,
      version: EngineVersion.OPENSEARCH_3_7,
      enableVersionUpgrade: true,

      // One small node: no dedicated masters, no replicas across AZs, no standby.
      capacity: {
        dataNodes: 1,
        dataNodeInstanceType: DATA_NODE_INSTANCE_TYPE,
        multiAzWithStandbyEnabled: false,
      },
      zoneAwareness: { enabled: false },
      ebs: { volumeSize: 10, volumeType: EbsDeviceVolumeType.GP3 },

      // Public endpoint (Bedrock Knowledge Bases can't reach a VPC domain), locked down below.
      ipAddressType: IpAddressType.DUAL_STACK,
      enforceHttps: true,
      tlsSecurityPolicy: TLSSecurityPolicy.TLS_1_2,
      nodeToNodeEncryption: true,
      encryptionAtRest: { enabled: true },

      // Fine-grained access control with an IAM role as master user: every request must be
      // SigV4-signed and is then mapped to an OpenSearch role. No internal users or passwords.
      fineGrainedAccessControl: { masterUserArn: this.adminRole.roleArn },

      // Layer 1: only signed requests from this account's IAM principals get past the endpoint.
      accessPolicies: [
        new PolicyStatement({
          principals: [new AccountRootPrincipal()],
          actions: ['es:ESHttp*'],
          resources: [
            this.formatArn({ service: 'es', resource: 'domain', resourceName: `${DOMAIN_NAME}/*` }),
          ],
        }),
      ],

      logging: {
        appLogEnabled: true,
        appLogGroup: appLogs,
        slowSearchLogEnabled: true,
        slowSearchLogGroup: slowSearchLogs,
      },

      removalPolicy: RemovalPolicy.DESTROY,
    });

    // The access policy delegates to IAM, so the admin role also needs its own HTTP permissions.
    this.adminRole.addToPolicy(
      new PolicyStatement({ actions: ['es:ESHttp*'], resources: [`${this.domain.domainArn}/*`] }),
    );

    // Creates and maps one fine-grained access control role per workload (see OpenSearchRole).
    this.openSearchRoles = new OpenSearchRoleProvider(this, 'OpenSearchRoles', {
      domain: this.domain,
      adminRole: this.adminRole,
    });

    // Private, encrypted, TLS-only. SSE-S3 (not KMS) keeps ETags equal to the MD5 of the content,
    // which the ingest uses to skip unchanged files. Emptied and deleted with the stack.
    this.docsBucket = new Bucket(this, 'DocsBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Full ingest: Collection API → normalise → new versioned index → alias swap → KB documents.
    const ingest = new NodejsFunction(this, 'IngestFunction', {
      description: 'Fetches a Collection API sample and rebuilds the objects index',
      ...LAMBDA_DEFAULTS,
      entry: `${FUNCTIONS_DIR}ingest/handler.ts`,
      memorySize: 1024,
      timeout: Duration.minutes(10),
      // One ingest at a time, so two runs can't race on the alias swap.
      reservedConcurrentExecutions: 1,
      environment: {
        ...LAMBDA_DEFAULTS.environment,
        DOMAIN_ENDPOINT: this.domain.domainEndpoint,
        DOCS_BUCKET: this.docsBucket.bucketName,
      },
      logGroup: new LogGroup(this, 'IngestLogs', {
        retention: RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });

    // List, read, write and delete under kb/ only.
    this.docsBucket.grantReadWrite(ingest, `${KB_PREFIX}*`);
    this.docsBucket.grantDelete(ingest, `${KB_PREFIX}*`);

    // Write access to the objects indices and alias only: no other index, no security config.
    new OpenSearchRole(this, 'IngestWriterRole', {
      provider: this.openSearchRoles,
      domain: this.domain,
      adminRole: this.adminRole,
      roleName: 'ingest_writer',
      backendRoles: [ingest.role as IRole],
      clusterPermissions: ['cluster_composite_ops', 'cluster_monitor'],
      indexPermissions: [
        {
          indexPatterns: [OBJECTS_ALIAS, `${OBJECTS_ALIAS}-*`],
          allowedActions: ['crud', 'manage'],
        },
      ],
    });

    // Daily full refresh at 3 am Sydney time (Scheduler handles daylight saving; a classic
    // EventBridge rule is UTC only). Deployed disabled; enable with `-c dailyRefresh=true`.
    // See docs/adr/0005-collection-data-use-and-refresh.md.
    new Schedule(this, 'DailyRefresh', {
      description: 'Daily full re-ingest from the Collection API',
      schedule: ScheduleExpression.cron({
        minute: '0',
        hour: '3',
        timeZone: TimeZone.AUSTRALIA_SYDNEY,
      }),
      target: new LambdaInvoke(ingest, { retryAttempts: 0 }),
      enabled: this.node.tryGetContext('dailyRefresh') === 'true',
    });

    new CfnOutput(this, 'IngestFunctionName', { value: ingest.functionName });
    new CfnOutput(this, 'DomainEndpoint', { value: this.domain.domainEndpoint });
    new CfnOutput(this, 'DomainArn', { value: this.domain.domainArn });
    new CfnOutput(this, 'AdminRoleArn', { value: this.adminRole.roleArn });
  }
}
