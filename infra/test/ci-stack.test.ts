import { readFileSync } from 'node:fs';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../lib/app.js';
import { CiStack } from '../lib/ci-stack.js';

const { context } = JSON.parse(readFileSync(new URL('../cdk.json', import.meta.url), 'utf8'));
const env = { account: '111111111111', region: 'ap-southeast-2' };

describe('CiStack', () => {
  const template = Template.fromStack(
    new CiStack(new App({ context }), 'Ci', { env, githubRepo: 'example-owner/example-repo' }),
  );
  const [role] = Object.values(template.findResources('AWS::IAM::Role'));
  const [policy] = Object.values(template.findResources('AWS::IAM::Policy'));

  it("trusts GitHub's OIDC provider for AWS STS only", () => {
    template.hasResourceProperties('AWS::IAM::OIDCProvider', {
      Url: 'https://token.actions.githubusercontent.com',
      ClientIdList: ['sts.amazonaws.com'],
    });
  });

  it('can be assumed only from the main branch of one repository', () => {
    const [statement] = role?.Properties.AssumeRolePolicyDocument.Statement ?? [];
    expect(statement.Action).toBe('sts:AssumeRoleWithWebIdentity');
    expect(statement.Condition).toEqual({
      StringEquals: {
        'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        'token.actions.githubusercontent.com:sub':
          'repo:example-owner/example-repo:ref:refs/heads/main',
      },
    });
  });

  it('can do nothing but assume the CDK bootstrap roles', () => {
    const statements = policy?.Properties.PolicyDocument.Statement ?? [];
    expect(statements).toHaveLength(1);
    expect(statements[0].Action).toBe('sts:AssumeRole');
    const resources = JSON.stringify(statements[0].Resource);
    for (const kind of ['deploy', 'file-publishing', 'lookup']) {
      expect(resources).toContain(`role/cdk-hnb659fds-${kind}-role-111111111111-ap-southeast-2`);
    }
    expect(resources).not.toContain('*');
  });

  it('refuses a repository that is not owner/name', () => {
    expect(
      () => new CiStack(new App({ context }), 'Bad', { env, githubRepo: 'repo:*:ref:*' }),
    ).toThrow(/owner\/name/);
  });
});

describe('the app', () => {
  const stackIds = (app: App) => app.node.children.filter(Stack.isStack).map((s) => s.stackName);

  it('adds the Ci stack only when it knows which repository to trust', () => {
    const saved = process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_REPOSITORY;
    try {
      expect(stackIds(buildApp(new App({ context })))).not.toContain('CollectionSearch-Ci');
      expect(
        stackIds(buildApp(new App({ context: { ...context, githubRepo: 'example-owner/x' } }))),
      ).toContain('CollectionSearch-Ci');
    } finally {
      if (saved !== undefined) process.env.GITHUB_REPOSITORY = saved;
    }
  });
});
