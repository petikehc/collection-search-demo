import { fromNodeProviderChain, fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';

export interface OpenSearchClientOptions {
  /** Domain endpoint host name, without https:// */
  endpoint: string;
  region: string;
  /** Sign as this role instead of the caller's own credentials (e.g. the admin role). */
  assumeRoleArn?: string;
}

/**
 * An OpenSearch client that signs every request with SigV4 (service "es").
 * The domain rejects unsigned requests, and fine-grained access control maps the signing
 * IAM role to an OpenSearch role.
 */
export function createOpenSearchClient({
  endpoint,
  region,
  assumeRoleArn,
}: OpenSearchClientOptions): Client {
  const credentials = assumeRoleArn
    ? fromTemporaryCredentials({
        params: { RoleArn: assumeRoleArn, RoleSessionName: 'collection-search' },
        clientConfig: { region },
      })
    : fromNodeProviderChain();

  return new Client({
    ...AwsSigv4Signer({ region, service: 'es', getCredentials: () => credentials() }),
    node: `https://${endpoint}`,
  });
}
