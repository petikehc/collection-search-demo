import { readFileSync } from 'node:fs';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { DATA_NODE_INSTANCE_TYPE, SearchStack } from '../lib/search-stack.js';

const { context } = JSON.parse(readFileSync(new URL('../cdk.json', import.meta.url), 'utf8'));

describe('SearchStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context });
    const stack = new SearchStack(app, 'Test', {
      env: { account: '111111111111', region: 'ap-southeast-2' },
    });
    template = Template.fromStack(stack);
  });

  it('creates one small single-AZ data node with gp3 storage', () => {
    template.hasResourceProperties('AWS::OpenSearchService::Domain', {
      ClusterConfig: Match.objectLike({
        InstanceCount: 1,
        InstanceType: DATA_NODE_INSTANCE_TYPE,
        DedicatedMasterEnabled: false,
        MultiAZWithStandbyEnabled: false,
        ZoneAwarenessEnabled: false,
      }),
      EBSOptions: Match.objectLike({ VolumeSize: 10, VolumeType: 'gp3' }),
    });
  });

  it('encrypts in transit and at rest, and enforces HTTPS with TLS 1.2+', () => {
    template.hasResourceProperties('AWS::OpenSearchService::Domain', {
      NodeToNodeEncryptionOptions: { Enabled: true },
      EncryptionAtRestOptions: Match.objectLike({ Enabled: true }),
      DomainEndpointOptions: Match.objectLike({
        EnforceHTTPS: true,
        TLSSecurityPolicy: 'Policy-Min-TLS-1-2-2019-07',
      }),
    });
  });

  it('uses fine-grained access control with the admin IAM role as master and no internal users', () => {
    template.hasResourceProperties('AWS::OpenSearchService::Domain', {
      AdvancedSecurityOptions: {
        Enabled: true,
        InternalUserDatabaseEnabled: false,
        MasterUserOptions: {
          MasterUserARN: { 'Fn::GetAtt': [Match.stringLikeRegexp('^OpenSearchAdminRole'), 'Arn'] },
        },
      },
    });
  });

  it('only lets this account’s IAM principals through the access policy', () => {
    const json = JSON.stringify(template.toJSON());
    expect(json).not.toMatch(/"Principal":\s*\{\s*"AWS":\s*"\*"/);
    expect(json).toContain('arn:aws:iam::111111111111:root');
  });

  it('is deleted, not retained, when the stack is destroyed', () => {
    template.hasResource('AWS::OpenSearchService::Domain', { DeletionPolicy: 'Delete' });
  });
});

describe('SearchStack ingest', () => {
  const app = new App({ context });
  const template = Template.fromStack(
    new SearchStack(app, 'IngestTest', {
      env: { account: '111111111111', region: 'ap-southeast-2' },
    }),
  );

  it('runs at most one ingest at a time', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Description: Match.stringLikeRegexp('rebuilds the objects index'),
      ReservedConcurrentExecutions: 1,
      Runtime: 'nodejs24.x',
      Architectures: ['arm64'],
    });
  });

  it('maps the ingest Lambda to a write role scoped to the objects indices', () => {
    template.hasResourceProperties('Custom::OpenSearchRole', {
      RoleName: 'ingest_writer',
      BackendRoles: [{ 'Fn::GetAtt': [Match.stringLikeRegexp('^IngestFunction'), 'Arn'] }],
      IndexPermissions: [
        { index_patterns: ['objects', 'objects-*'], allowed_actions: ['crud', 'manage'] },
      ],
    });
  });

  it('lets the role custom resource assume only the admin role', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'sts:AssumeRole',
            Resource: { 'Fn::GetAtt': [Match.stringLikeRegexp('^OpenSearchAdminRole'), 'Arn'] },
          }),
        ]),
      },
    });
  });
});

describe('SearchStack daily refresh', () => {
  const build = (extra: Record<string, string> = {}) =>
    Template.fromStack(
      new SearchStack(new App({ context: { ...context, ...extra } }), 'RefreshTest', {
        env: { account: '111111111111', region: 'ap-southeast-2' },
      }),
    );

  it('runs at 3 am Sydney time and is disabled by default', () => {
    build().hasResourceProperties('AWS::Scheduler::Schedule', {
      ScheduleExpression: 'cron(0 3 * * ? *)',
      ScheduleExpressionTimezone: 'Australia/Sydney',
      State: 'DISABLED',
    });
  });

  it('is enabled with -c dailyRefresh=true', () => {
    build({ dailyRefresh: 'true' }).hasResourceProperties('AWS::Scheduler::Schedule', {
      State: 'ENABLED',
    });
  });
});
