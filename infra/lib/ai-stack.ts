import { CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { CfnDataSource, CfnKnowledgeBase } from 'aws-cdk-lib/aws-bedrock';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import {
  CustomDataIdentifier,
  DataIdentifier,
  DataProtectionPolicy,
  LogGroup,
  RetentionDays,
} from 'aws-cdk-lib/aws-logs';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from 'aws-cdk-lib/custom-resources';
import type { Construct } from 'constructs';
import { KB_PREFIX } from '../../functions/lib/kb/documents.js';
import { OpenSearchIndex, OpenSearchRole } from './opensearch-role.js';
import type { SearchStack } from './search-stack.js';

export const KB_INDEX = 'kb-objects';
export const EMBEDDING_MODEL_ID = 'amazon.titan-embed-text-v2:0';
const EMBEDDING_DIMENSIONS = 1024;

/** Australian phone numbers (CloudWatch has no managed identifier for them): 04xx xxx xxx, 02 xxxx xxxx, +61 … */
export const AU_PHONE_REGEX = '(\\+61|0)[2-478]( ?[0-9]){8}';

/** Field names in the KB vector index; Bedrock is told about them in the KB's field mapping. */
const FIELDS = {
  vector: 'embedding',
  text: 'AMAZON_BEDROCK_TEXT_CHUNK',
  metadata: 'AMAZON_BEDROCK_METADATA',
};

export interface AiStackProps extends StackProps {
  search: SearchStack;
}

/**
 * Bedrock Knowledge Base over the collection documents, with its vectors stored in the
 * OpenSearch domain (docs/adr/0002). Embeddings use Titan Text Embeddings V2 in Sydney.
 */
export class AiStack extends Stack {
  readonly knowledgeBase: CfnKnowledgeBase;

  constructor(scope: Construct, id: string, props: AiStackProps) {
    super(scope, id, { description: 'Collection search: Bedrock Knowledge Base', ...props });
    const { domain, adminRole, openSearchRoles, docsBucket } = props.search;

    // The vector index must exist before the KB is created; Bedrock validates its mapping.
    // faiss + HNSW with l2 distance, as Bedrock requires for managed domains (nmslib isn't supported).
    const index = new OpenSearchIndex(this, 'KbIndex', {
      provider: openSearchRoles,
      domain,
      adminRole,
      indexName: KB_INDEX,
      definition: {
        settings: { index: { knn: true, number_of_shards: 1, number_of_replicas: 0 } },
        mappings: {
          properties: {
            [FIELDS.vector]: {
              type: 'knn_vector',
              dimension: EMBEDDING_DIMENSIONS,
              space_type: 'l2',
              method: {
                name: 'hnsw',
                engine: 'faiss',
                parameters: { ef_construction: 128, m: 24 },
              },
            },
            [FIELDS.text]: { type: 'text', index: true },
            [FIELDS.metadata]: { type: 'text', index: false },
          },
        },
      },
    });

    // Assumed by Bedrock only on behalf of a Knowledge Base in this account (no confused deputy).
    const kbRole = new Role(this, 'KnowledgeBaseRole', {
      description: 'Bedrock Knowledge Base service role for the collection KB',
      assumedBy: new ServicePrincipal('bedrock.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
          ArnLike: {
            'aws:SourceArn': this.formatArn({
              service: 'bedrock',
              resource: 'knowledge-base',
              resourceName: '*',
            }),
          },
        },
      }),
    });

    const embeddingModelArn = this.formatArn({
      service: 'bedrock',
      account: '',
      resource: 'foundation-model',
      resourceName: EMBEDDING_MODEL_ID,
    });
    kbRole.addToPolicy(
      new PolicyStatement({ actions: ['bedrock:InvokeModel'], resources: [embeddingModelArn] }),
    );
    kbRole.addToPolicy(
      new PolicyStatement({ actions: ['es:DescribeDomain'], resources: [domain.domainArn] }),
    );
    docsBucket.grantRead(kbRole, `${KB_PREFIX}*`);

    // Read, write and delete vectors in kb-objects, and read its mapping: nothing else.
    const kbAccess = new OpenSearchRole(this, 'KbAccessRole', {
      provider: openSearchRoles,
      domain,
      adminRole,
      roleName: 'kb_access',
      backendRoles: [kbRole],
      clusterPermissions: ['cluster_composite_ops', 'cluster_monitor'],
      indexPermissions: [
        {
          indexPatterns: [KB_INDEX],
          allowedActions: ['crud', 'indices:admin/get', 'indices:admin/mappings/get'],
        },
      ],
      httpAccess: {
        actions: [
          'es:ESHttpGet',
          'es:ESHttpHead',
          'es:ESHttpPost',
          'es:ESHttpPut',
          'es:ESHttpDelete',
        ],
        paths: [KB_INDEX, `${KB_INDEX}/*`],
      },
    });

    this.knowledgeBase = new CfnKnowledgeBase(this, 'KnowledgeBase', {
      name: 'collection-search-kb',
      description: 'Collection objects from the National Museum of Australia Collection API',
      roleArn: kbRole.roleArn,
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn,
          embeddingModelConfiguration: {
            bedrockEmbeddingModelConfiguration: { dimensions: EMBEDDING_DIMENSIONS },
          },
        },
      },
      storageConfiguration: {
        type: 'OPENSEARCH_MANAGED_CLUSTER',
        opensearchManagedClusterConfiguration: {
          domainArn: domain.domainArn,
          domainEndpoint: `https://${domain.domainEndpoint}`,
          vectorIndexName: KB_INDEX,
          fieldMapping: {
            vectorField: FIELDS.vector,
            textField: FIELDS.text,
            metadataField: FIELDS.metadata,
          },
        },
      },
    });
    // Bedrock checks the index and its own access when the KB is created.
    this.knowledgeBase.node.addDependency(index, kbAccess, kbRole);

    // One object per file, and objects are short: no chunking, so each citation is one object.
    const dataSource = new CfnDataSource(this, 'DocsDataSource', {
      knowledgeBaseId: this.knowledgeBase.attrKnowledgeBaseId,
      name: 'collection-objects',
      dataDeletionPolicy: 'DELETE',
      dataSourceConfiguration: {
        type: 'S3',
        s3Configuration: { bucketArn: docsBucket.bucketArn, inclusionPrefixes: [KB_PREFIX] },
      },
      vectorIngestionConfiguration: {
        chunkingConfiguration: { chunkingStrategy: 'NONE' },
      },
    });

    // Model invocation logging: an account and region setting (not a stack resource), so a custom
    // resource turns it on and, on delete, off. The logs hold full prompts and answers, and the
    // guardrail's masking doesn't apply to them, so CloudWatch data protection masks contact details.
    const invocationLogs = new LogGroup(this, 'ModelInvocationLogs', {
      retention: RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
      dataProtectionPolicy: new DataProtectionPolicy({
        name: 'mask-personal-details',
        identifiers: [
          DataIdentifier.EMAILADDRESS,
          new CustomDataIdentifier('AuPhoneNumber', AU_PHONE_REGEX),
          // The guardrail blocks card numbers, but the invocation log still keeps the original input.
          DataIdentifier.CREDITCARDNUMBER,
          DataIdentifier.CREDITCARDEXPIRATION,
          DataIdentifier.CREDITCARDSECURITYCODE,
        ],
      }),
    });
    const loggingRole = new Role(this, 'InvocationLoggingRole', {
      description: 'Lets Bedrock write model invocation logs for this account',
      assumedBy: new ServicePrincipal('bedrock.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
          ArnLike: { 'aws:SourceArn': this.formatArn({ service: 'bedrock', resource: '*' }) },
        },
      }),
    });
    invocationLogs.grantWrite(loggingRole);

    new AwsCustomResource(this, 'InvocationLogging', {
      onUpdate: {
        service: 'bedrock',
        action: 'PutModelInvocationLoggingConfiguration',
        parameters: {
          loggingConfig: {
            cloudWatchConfig: {
              logGroupName: invocationLogs.logGroupName,
              roleArn: loggingRole.roleArn,
            },
            textDataDeliveryEnabled: true,
            imageDataDeliveryEnabled: false,
            embeddingDataDeliveryEnabled: false,
          },
        },
        physicalResourceId: PhysicalResourceId.of('bedrock-model-invocation-logging'),
      },
      onDelete: { service: 'bedrock', action: 'DeleteModelInvocationLoggingConfiguration' },
      policy: AwsCustomResourcePolicy.fromStatements([
        new PolicyStatement({
          actions: [
            'bedrock:PutModelInvocationLoggingConfiguration',
            'bedrock:DeleteModelInvocationLoggingConfiguration',
          ],
          resources: ['*'],
        }),
        new PolicyStatement({ actions: ['iam:PassRole'], resources: [loggingRole.roleArn] }),
      ]),
    });

    new CfnOutput(this, 'KnowledgeBaseId', { value: this.knowledgeBase.attrKnowledgeBaseId });
    new CfnOutput(this, 'DataSourceId', { value: dataSource.attrDataSourceId });
  }
}
