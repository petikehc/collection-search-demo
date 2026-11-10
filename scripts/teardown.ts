/**
 * Deletes every CollectionSearch-* stack (except the CI stack), then cleans up what
 * CloudFormation leaves behind, and finishes with `pnpm status`.
 *
 *   pnpm teardown --dry-run   # show what would be deleted; change nothing
 *   pnpm teardown             # asks you to type the project name to confirm
 *   pnpm teardown --yes       # no prompt (for scripts)
 */
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import {
  BedrockClient,
  DeleteModelInvocationLoggingConfigurationCommand,
  GetModelInvocationLoggingConfigurationCommand,
} from '@aws-sdk/client-bedrock';
import { CloudWatchLogsClient, DeleteLogGroupCommand } from '@aws-sdk/client-cloudwatch-logs';
import {
  KEEP_STACKS,
  leftoverLogGroups,
  PROJECT_TAG,
  projectStacks,
  STACK_PREFIX,
  taggedResources,
} from './lib/inventory.js';
import { REGION } from './lib/stack-outputs.js';
import { printStatus } from './status.js';

const dryRun = process.argv.includes('--dry-run');
const assumeYes = process.argv.includes('--yes');

const stacks = await projectStacks();
const toDestroy = stacks.filter((s) => !KEEP_STACKS.includes(s.name)).map((s) => s.name);
const kept = stacks.filter((s) => KEEP_STACKS.includes(s.name)).map((s) => s.name);

console.log(`Stacks to delete: ${toDestroy.join(', ') || '(none)'}`);
if (kept.length) console.log(`Stacks kept:      ${kept.join(', ')}`);
console.log(
  'Then: delete leftover log groups, switch off Bedrock invocation logging if it is ours.',
);

if (dryRun) {
  console.log('\n--dry-run: nothing changed.');
  console.log(
    `Right now: ${(await leftoverLogGroups()).length} project log groups and ` +
      `${(await taggedResources()).length} resources tagged project=${PROJECT_TAG.value}. ` +
      'Most belong to the stacks and go with them; anything left afterwards is cleaned up or listed.',
  );
  process.exit(0);
}

if (!assumeYes) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\nType "${PROJECT_TAG.value}" to delete these stacks: `);
  rl.close();
  if (answer.trim() !== PROJECT_TAG.value) {
    console.log('Not confirmed; nothing deleted.');
    process.exit(1);
  }
}

if (toDestroy.length) {
  // CDK works out the order (Api before Search, because of the cross-stack references).
  const destroy = spawnSync(
    'pnpm',
    ['--filter', 'infra', 'exec', 'cdk', 'destroy', ...toDestroy, '--force'],
    { stdio: 'inherit' },
  );
  if (destroy.status !== 0) {
    console.error('\ncdk destroy failed: fix the error above and run teardown again.');
    process.exit(destroy.status ?? 1);
  }
}

console.log('\nCleaning up leftovers');
const logs = new CloudWatchLogsClient({ region: REGION });
for (const name of await leftoverLogGroups()) {
  await logs.send(new DeleteLogGroupCommand({ logGroupName: name }));
  console.log(`  deleted log group ${name}`);
}

// Bedrock invocation logging is an account/region setting, not a stack resource.
// Only switch it off if it points at one of this project's log groups.
const bedrock = new BedrockClient({ region: REGION });
const logging = await bedrock.send(new GetModelInvocationLoggingConfigurationCommand({}));
const target = logging.loggingConfig?.cloudWatchConfig?.logGroupName;
if (target?.startsWith(STACK_PREFIX)) {
  await bedrock.send(new DeleteModelInvocationLoggingConfigurationCommand({}));
  console.log(`  switched off Bedrock invocation logging (was → ${target})`);
}

const stillTagged = await taggedResources();
if (stillTagged.length) {
  console.log(
    `  still tagged project=${PROJECT_TAG.value} (the tagging API can lag a few minutes):`,
  );
  for (const arn of stillTagged) console.log(`    ${arn}`);
}

console.log('');
await printStatus();
