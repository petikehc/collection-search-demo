import { CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { EbsDeviceVolumeType } from 'aws-cdk-lib/aws-ec2';
import { AccountRootPrincipal, PolicyStatement, Role } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import {
  Domain,
  EngineVersion,
  IpAddressType,
  TLSSecurityPolicy,
} from 'aws-cdk-lib/aws-opensearchservice';
import type { Construct } from 'constructs';

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

    new CfnOutput(this, 'DomainEndpoint', { value: this.domain.domainEndpoint });
    new CfnOutput(this, 'DomainArn', { value: this.domain.domainArn });
    new CfnOutput(this, 'AdminRoleArn', { value: this.adminRole.roleArn });
  }
}
