import { App, Aspects, type Environment } from 'aws-cdk-lib';
import { AiStack } from './ai-stack.js';
import { ApiStack } from './api-stack.js';
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
  new ApiStack(app, 'CollectionSearch-Api', { env, tags: PROJECT_TAGS, search, ai });

  Aspects.of(app).add(new LogGroupDefaults());

  return app;
}
