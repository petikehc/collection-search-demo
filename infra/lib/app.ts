import { App, Aspects, type Environment } from 'aws-cdk-lib';
import { AiStack } from './ai-stack.js';
import { ApiStack } from './api-stack.js';
import { AuthStack } from './auth-stack.js';
import { CiStack } from './ci-stack.js';
import { LogGroupDefaults } from './log-group-defaults.js';
import { SearchStack } from './search-stack.js';

export const PROJECT_TAGS = { project: 'collection-search-demo', 'managed-by': 'cdk' };

/**
 * Builds the whole CDK app. Kept separate from bin/app.ts so tests can synthesise it.
 * Account and region come from the CLI's resolved credentials (AWS_PROFILE), never from code.
 */
export function buildApp(app = new App()): App {
  const env: Environment = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'ap-southeast-2',
  };

  // Stack tags (explicitStackTags flag) are propagated by CloudFormation to every resource
  // that supports tags, so teardown and cost reports can find them.
  const search = new SearchStack(app, 'CollectionSearch-Search', { env, tags: PROJECT_TAGS });
  const ai = new AiStack(app, 'CollectionSearch-Ai', { env, tags: PROJECT_TAGS, search });
  const auth = new AuthStack(app, 'CollectionSearch-Auth', { env, tags: PROJECT_TAGS });
  new ApiStack(app, 'CollectionSearch-Api', {
    env,
    tags: PROJECT_TAGS,
    search,
    ai,
    userPool: auth.userPool,
  });

  // The deploy role for GitHub Actions. The repository comes from `-c githubRepo=owner/name`, or
  // from GITHUB_REPOSITORY inside GitHub Actions, so no account or user name is in the code.
  const githubRepo = app.node.tryGetContext('githubRepo') ?? process.env.GITHUB_REPOSITORY;
  if (githubRepo) {
    new CiStack(app, 'CollectionSearch-Ci', { env, tags: PROJECT_TAGS, githubRepo });
  }

  Aspects.of(app).add(new LogGroupDefaults());

  return app;
}
