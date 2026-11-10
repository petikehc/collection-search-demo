import { CustomResource, Duration } from 'aws-cdk-lib';
import { type IRole, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { Domain } from 'aws-cdk-lib/aws-opensearchservice';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

export const FUNCTIONS_DIR = new URL('../../functions/', import.meta.url).pathname;

/** One provider per domain; every OpenSearchRole for that domain reuses it. */
export class OpenSearchRoleProvider extends Construct {
  readonly serviceToken: string;

  constructor(scope: Construct, id: string, props: { domain: Domain; adminRole: IRole }) {
    super(scope, id);

    const onEvent = new NodejsFunction(this, 'Handler', {
      entry: `${FUNCTIONS_DIR}opensearch-role/handler.ts`,
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(2),
    });
    // The handler signs as the admin role; it needs nothing else.
    onEvent.addToRolePolicy(
      new PolicyStatement({ actions: ['sts:AssumeRole'], resources: [props.adminRole.roleArn] }),
    );

    this.serviceToken = new Provider(this, 'Provider', { onEventHandler: onEvent }).serviceToken;
  }
}

export interface IndexPermission {
  indexPatterns: string[];
  allowedActions: string[];
}

export interface OpenSearchRoleProps {
  provider: OpenSearchRoleProvider;
  domain: Domain;
  adminRole: IRole;
  /** Name of the role inside OpenSearch, e.g. "ingest_writer". */
  roleName: string;
  /** IAM roles whose signed requests map to this OpenSearch role. */
  backendRoles: IRole[];
  clusterPermissions?: string[];
  indexPermissions: IndexPermission[];
}

/**
 * A fine-grained access control role plus its mapping to IAM roles, managed by CloudFormation.
 * Also grants the IAM roles HTTP access to the domain, because the access policy delegates to IAM:
 * a request needs both the IAM permission and the OpenSearch role to succeed.
 */
export class OpenSearchRole extends Construct {
  constructor(scope: Construct, id: string, props: OpenSearchRoleProps) {
    super(scope, id);

    for (const role of props.backendRoles) {
      role.addToPrincipalPolicy(
        new PolicyStatement({
          actions: [
            'es:ESHttpGet',
            'es:ESHttpHead',
            'es:ESHttpPost',
            'es:ESHttpPut',
            'es:ESHttpDelete',
          ],
          resources: [`${props.domain.domainArn}/*`],
        }),
      );
    }

    new CustomResource(this, 'Resource', {
      serviceToken: props.provider.serviceToken,
      resourceType: 'Custom::OpenSearchRole',
      properties: {
        Endpoint: props.domain.domainEndpoint,
        AdminRoleArn: props.adminRole.roleArn,
        RoleName: props.roleName,
        BackendRoles: props.backendRoles.map((r) => r.roleArn),
        ClusterPermissions: props.clusterPermissions ?? [],
        IndexPermissions: props.indexPermissions.map((p) => ({
          index_patterns: p.indexPatterns,
          allowed_actions: p.allowedActions,
        })),
      },
    });
  }
}
