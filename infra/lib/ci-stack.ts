import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import {
  OidcProviderNative,
  OpenIdConnectPrincipal,
  PolicyStatement,
  Role,
} from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

const GITHUB_OIDC_URL = 'https://token.actions.githubusercontent.com';
/** The default bootstrap qualifier (`cdk bootstrap` without --qualifier). */
const BOOTSTRAP_QUALIFIER = 'hnb659fds';

export interface CiStackProps extends StackProps {
  /** `owner/name` of the GitHub repository allowed to deploy. */
  githubRepo: string;
}

/**
 * Lets GitHub Actions deploy this app without stored AWS keys: a workflow run on `main` of one
 * repository exchanges GitHub's signed OIDC token for short-lived credentials (OIDC federation).
 * Deployed once by hand and kept by `pnpm teardown`.
 */
export class CiStack extends Stack {
  constructor(scope: Construct, id: string, props: CiStackProps) {
    super(scope, id, { description: 'Collection search: GitHub Actions deploy role', ...props });
    if (!/^[\w.-]+\/[\w.-]+$/.test(props.githubRepo)) {
      throw new Error(`githubRepo must be owner/name, got "${props.githubRepo}"`);
    }

    // An account can have only one provider for this URL. This account had none; where one exists,
    // use OidcProviderNative.fromOidcProviderArn instead of creating another.
    const github = new OidcProviderNative(this, 'GitHubOidc', {
      url: GITHUB_OIDC_URL,
      clientIds: ['sts.amazonaws.com'],
    });

    // Only a workflow run on this repository's main branch can assume the role: not a fork,
    // a pull request or another branch. `sub` is set by GitHub and can't be chosen by the workflow.
    const role = new Role(this, 'DeployRole', {
      description: `GitHub Actions deploys from ${props.githubRepo} (main only)`,
      maxSessionDuration: Duration.hours(1),
      assumedBy: new OpenIdConnectPrincipal(github, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': `repo:${props.githubRepo}:ref:refs/heads/main`,
        },
      }),
    });

    // Nothing but the CDK bootstrap roles, which `cdk deploy` uses for each part of a deploy.
    // What a deploy may change is then decided by the bootstrap (CloudFormation's execution role).
    role.addToPolicy(
      new PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: ['deploy', 'file-publishing', 'lookup'].map((kind) =>
          this.formatArn({
            service: 'iam',
            region: '',
            resource: 'role',
            resourceName: `cdk-${BOOTSTRAP_QUALIFIER}-${kind}-role-${this.account}-${this.region}`,
          }),
        ),
      }),
    );

    new CfnOutput(this, 'DeployRoleArn', { value: role.roleArn });
  }
}
