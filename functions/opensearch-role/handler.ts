import type { Client } from '@opensearch-project/opensearch';
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

/** Properties set by the OpenSearchIndex construct (infra/lib/opensearch-role.ts). */
export interface OpenSearchIndexProps {
  Endpoint: string;
  AdminRoleArn: string;
  IndexName: string;
  /** JSON string, so CloudFormation doesn't turn numbers and booleans into strings. */
  Definition: string;
}

/** Properties set by the OpenSearchSearchPipeline construct (infra/lib/opensearch-role.ts). */
export interface OpenSearchSearchPipelineProps {
  Endpoint: string;
  AdminRoleArn: string;
  PipelineName: string;
  /** JSON string, so CloudFormation doesn't turn numbers into strings. */
  Definition: string;
}

type Event = CloudFormationCustomResourceEvent;
type HttpError = { meta?: { statusCode?: number } };

const ignore = (status: number) => (err: HttpError) => {
  if (err.meta?.statusCode !== status) throw err;
};

/**
 * Custom resources (via the CDK Provider framework) for the parts of OpenSearch that
 * CloudFormation can't manage: fine-grained access control roles and mappings
 * (Custom::OpenSearchRole), indices that other services write to (Custom::OpenSearchIndex) and
 * search pipelines (Custom::OpenSearchSearchPipeline).
 * Requests are signed as the admin role, the only principal allowed to change these.
 */
export async function handler(event: Event) {
  const { Endpoint, AdminRoleArn } = event.ResourceProperties as unknown as OpenSearchRoleProps;
  const client = createOpenSearchClient({
    endpoint: Endpoint,
    region: process.env.AWS_REGION ?? '',
    assumeRoleArn: AdminRoleArn,
  });
  if (event.ResourceType === 'Custom::OpenSearchIndex') return handleIndex(client, event);
  if (event.ResourceType === 'Custom::OpenSearchSearchPipeline') {
    return handleSearchPipeline(client, event);
  }
  return handleRole(client, event);
}

/** A search pipeline can be replaced in place: PUT is create-or-update. */
async function handleSearchPipeline(client: Client, event: Event) {
  const props = event.ResourceProperties as unknown as OpenSearchSearchPipelineProps;
  const path = (name: string) => `/_search/pipeline/${encodeURIComponent(name)}`;

  if (event.RequestType === 'Delete') {
    await client.transport
      .request({ method: 'DELETE', path: path(event.PhysicalResourceId) })
      .catch(ignore(404));
    return { PhysicalResourceId: event.PhysicalResourceId };
  }
  await client.transport.request({
    method: 'PUT',
    path: path(props.PipelineName),
    body: props.Definition,
  });
  // A new physical ID on rename makes CloudFormation delete the old pipeline afterwards.
  return { PhysicalResourceId: props.PipelineName };
}

async function handleRole(client: Client, event: Event) {
  const props = event.ResourceProperties as unknown as OpenSearchRoleProps;
  const security = '/_plugins/_security/api';

  const remove = async (name: string) => {
    for (const kind of ['rolesmapping', 'roles']) {
      await client.transport
        .request({ method: 'DELETE', path: `${security}/${kind}/${name}` })
        .catch(ignore(404));
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

async function handleIndex(client: Client, event: Event) {
  const props = event.ResourceProperties as unknown as OpenSearchIndexProps;
  const indexPath = (name: string) => `/${encodeURIComponent(name)}`;

  if (event.RequestType === 'Delete') {
    await client.transport
      .request({ method: 'DELETE', path: indexPath(event.PhysicalResourceId) })
      .catch(ignore(404));
    return { PhysicalResourceId: event.PhysicalResourceId };
  }

  if (event.RequestType === 'Update') {
    const old = event.OldResourceProperties as unknown as OpenSearchIndexProps;
    if (old.IndexName === props.IndexName && old.Definition !== props.Definition) {
      // Mappings and analysers can't be changed on an existing index, and this index holds
      // data another service wrote. Make the change explicit: use a new index name.
      throw new Error(
        `Index ${props.IndexName} can't be redefined in place; give it a new IndexName`,
      );
    }
  }

  // Returning a new physical ID on rename makes CloudFormation delete the old index afterwards.
  await client.transport
    .request({ method: 'PUT', path: indexPath(props.IndexName), body: props.Definition })
    .catch((err: { meta?: { body?: { error?: { type?: string } } } }) => {
      // Re-running a create (e.g. after a failed deploy) finds the index already there.
      if (err.meta?.body?.error?.type !== 'resource_already_exists_exception') throw err;
    });
  return { PhysicalResourceId: props.IndexName };
}
