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
  /**
   * The repository allowed to deploy, as GitHub writes it at the start of the token's `sub`:
   * `repo:owner@ownerId/name@repoId` with immutable subjects (GitHub's default for new repos),
   * or `repo:owner/name`. Read it with
   * `gh api repos/OWNER/NAME/actions/oidc/customization/sub --jq .sub_claim_prefix`.
   */
  githubSubjectPrefix: string;
}

const SUBJECT_PREFIX = /^repo:[\w.-]+(@\d+)?\/[\w.-]+(@\d+)?$/;

/**
 * Lets GitHub Actions deploy this app without stored AWS keys: a workflow run on `main` of one
 * repository exchanges GitHub's signed OIDC token for short-lived credentials (OIDC federation).
 * Deployed once by hand and kept by `pnpm teardown`.
 */
export class CiStack extends Stack {
  constructor(scope: Construct, id: string, props: CiStackProps) {
    super(scope, id, { description: 'Collection search: GitHub Actions deploy role', ...props });
    const prefix = props.githubSubjectPrefix;
    if (!SUBJECT_PREFIX.test(prefix)) {
      throw new Error(`githubSubjectPrefix must be repo:owner/name, got "${prefix}"`);
    }

    // An account can have only one provider for this URL. This account had none; where one exists,
    // use OidcProviderNative.fromOidcProviderArn instead of creating another.
    const github = new OidcProviderNative(this, 'GitHubOidc', {
      url: GITHUB_OIDC_URL,
      clientIds: ['sts.amazonaws.com'],
    });

    // Only a workflow run on this repository's main branch can assume the role: not a fork,
    // a pull request or another branch. `sub` is set by GitHub and can't be chosen by the workflow.
    // With immutable subjects, the IDs also keep out a repository re-created under the same name.
    const role = new Role(this, 'DeployRole', {
      description: `GitHub Actions deploys from ${prefix} (main only)`,
      maxSessionDuration: Duration.hours(1),
      assumedBy: new OpenIdConnectPrincipal(github, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': `${prefix}:ref:refs/heads/main`,
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
