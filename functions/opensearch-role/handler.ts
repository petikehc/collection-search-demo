import type { CloudFormationCustomResourceEvent } from 'aws-lambda';
import { createOpenSearchClient } from '../lib/opensearch/client.js';

/** Properties set by the OpenSearchRole construct (infra/lib/opensearch-role.ts). */
export interface OpenSearchRoleProps {
  Endpoint: string;
  AdminRoleArn: string;
  RoleName: string;
  BackendRoles: string[];
  ClusterPermissions: string[];
  IndexPermissions: { index_patterns: string[]; allowed_actions: string[] }[];
}

/**
 * Custom resource (via the CDK Provider framework) that keeps one fine-grained access control
 * role and its role mapping in sync with CloudFormation. It signs requests as the admin role,
 * the only principal allowed to change OpenSearch security config.
 */
export async function handler(event: CloudFormationCustomResourceEvent) {
  const props = event.ResourceProperties as unknown as OpenSearchRoleProps & {
    ServiceToken: string;
  };
  const client = createOpenSearchClient({
    endpoint: props.Endpoint,
    region: process.env.AWS_REGION ?? '',
    assumeRoleArn: props.AdminRoleArn,
  });
  const security = '/_plugins/_security/api';

  const remove = async (name: string) => {
    for (const kind of ['rolesmapping', 'roles']) {
      await client.transport
        .request({ method: 'DELETE', path: `${security}/${kind}/${name}` })
        .catch((err: { meta?: { statusCode?: number } }) => {
          if (err.meta?.statusCode !== 404) throw err;
        });
    }
  };

  if (event.RequestType === 'Delete') {
    await remove(event.PhysicalResourceId);
    return { PhysicalResourceId: event.PhysicalResourceId };
  }

  await client.transport.request({
    method: 'PUT',
    path: `${security}/roles/${props.RoleName}`,
    body: {
      cluster_permissions: props.ClusterPermissions,
      index_permissions: props.IndexPermissions,
    },
  });
  await client.transport.request({
    method: 'PUT',
    path: `${security}/rolesmapping/${props.RoleName}`,
    body: { backend_roles: props.BackendRoles },
  });

  // Renaming a role replaces it: remove the old one so it doesn't linger with access.
  if (event.RequestType === 'Update' && event.PhysicalResourceId !== props.RoleName) {
    await remove(event.PhysicalResourceId);
  }
  return { PhysicalResourceId: props.RoleName };
}
