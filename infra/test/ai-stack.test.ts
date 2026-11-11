import { readFileSync } from 'node:fs';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { AiStack } from '../lib/ai-stack.js';
import { SearchStack } from '../lib/search-stack.js';

const { context } = JSON.parse(readFileSync(new URL('../cdk.json', import.meta.url), 'utf8'));
const env = { account: '111111111111', region: 'ap-southeast-2' };

describe('AiStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context });
    const search = new SearchStack(app, 'Search', { env });
    template = Template.fromStack(new AiStack(app, 'Ai', { env, search }));
  });

  it('stores vectors in the managed OpenSearch domain with Titan V2 embeddings', () => {
    template.hasResourceProperties('AWS::Bedrock::KnowledgeBase', {
      StorageConfiguration: {
        Type: 'OPENSEARCH_MANAGED_CLUSTER',
        OpensearchManagedClusterConfiguration: Match.objectLike({ VectorIndexName: 'kb-objects' }),
      },
      KnowledgeBaseConfiguration: {
        Type: 'VECTOR',
        VectorKnowledgeBaseConfiguration: Match.objectLike({
          EmbeddingModelArn: Match.stringLikeRegexp('amazon.titan-embed-text-v2:0'),
        }),
      },
    });
  });

  it('creates the KB only after its index and access mapping exist', () => {
    const [kb] = Object.values(template.findResources('AWS::Bedrock::KnowledgeBase'));
    const dependsOn = (kb?.DependsOn ?? []).join(' ');
    expect(dependsOn).toMatch(/KbIndex/);
    expect(dependsOn).toMatch(/KbAccessRole/);
  });

  it('uses a faiss HNSW vector field, as Bedrock requires', () => {
    const [index] = Object.values(template.findResources('Custom::OpenSearchIndex'));
    const definition = JSON.parse(index?.Properties.Definition);
    expect(definition.mappings.properties.embedding).toMatchObject({
      type: 'knn_vector',
      dimension: 1024,
      method: { name: 'hnsw', engine: 'faiss' },
    });
  });

  it('lets only Bedrock, for a KB in this account, assume the KB role', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Principal: { Service: 'bedrock.amazonaws.com' },
            Condition: Match.objectLike({ StringEquals: { 'aws:SourceAccount': '111111111111' } }),
          }),
        ],
      },
    });
  });

  it('does not chunk: one collection object, one chunk', () => {
    template.hasResourceProperties('AWS::Bedrock::DataSource', {
      DataDeletionPolicy: 'DELETE',
      VectorIngestionConfiguration: { ChunkingConfiguration: { ChunkingStrategy: 'NONE' } },
    });
  });
});

describe('AiStack model invocation logging', () => {
  const app = new App({ context });
  const search = new SearchStack(app, 'Search', { env });
  const template = Template.fromStack(new AiStack(app, 'Ai', { env, search }));

  it('masks email addresses, Australian phone numbers and card numbers in the invocation logs', () => {
    const [group] = Object.values(
      template.findResources('AWS::Logs::LogGroup', {
        Properties: { DataProtectionPolicy: Match.anyValue() },
      }),
    );
    const policy = JSON.stringify(group?.Properties.DataProtectionPolicy);
    expect(policy).toContain('EmailAddress');
    expect(policy).toContain('AuPhoneNumber');
    expect(policy).toContain('CreditCardNumber');
  });

  it('turns logging off again when the stack is deleted', () => {
    const [resource] = Object.values(template.findResources('Custom::AWS'));
    expect(JSON.stringify(resource?.Properties.Delete)).toContain(
      'DeleteModelInvocationLoggingConfiguration',
    );
  });
});
