/**
 * Read-only AWS inventory shared by `pnpm status` and `pnpm teardown`:
 * this project's stacks, anything billed by the hour, and account-wide settings we change.
 */
import { APIGatewayClient, GetAccountCommand } from '@aws-sdk/client-api-gateway';
import {
  BedrockClient,
  GetModelInvocationLoggingConfigurationCommand,
  ListProvisionedModelThroughputsCommand,
} from '@aws-sdk/client-bedrock';
import {
  CloudFormationClient,
  ListStacksCommand,
  type StackStatus,
} from '@aws-sdk/client-cloudformation';
import { CloudWatchLogsClient, DescribeLogGroupsCommand } from '@aws-sdk/client-cloudwatch-logs';
import {
  DescribeInstancesCommand,
  DescribeNatGatewaysCommand,
  EC2Client,
} from '@aws-sdk/client-ec2';
import {
  DescribeDomainsCommand,
  ListDomainNamesCommand,
  OpenSearchClient,
} from '@aws-sdk/client-opensearch';
import {
  ListCollectionsCommand,
  OpenSearchServerlessClient,
} from '@aws-sdk/client-opensearchserverless';
import {
  GetResourcesCommand,
  ResourceGroupsTaggingAPIClient,
} from '@aws-sdk/client-resource-groups-tagging-api';
import { REGION } from './stack-outputs.js';

export const STACK_PREFIX = 'CollectionSearch-';
/**
 * Kept by teardown, both free: the GitHub Actions OIDC role is set up once and reused, and the
 * web domain's certificate and domain name keep the hand-made DNS records valid.
 */
export const KEEP_STACKS = [`${STACK_PREFIX}Ci`, `${STACK_PREFIX}Domain`];
export const PROJECT_TAG = { key: 'project', value: 'collection-search-demo' };
/** The domain we deliberately keep running between sessions. */
export const EXPECTED_DOMAIN = 'collection-search';

/**
 * Sydney on-demand prices in USD per hour, from the AWS price list (November 2026).
 * Used only for the estimate in `pnpm status`; check the price list for anything not here.
 */
const OPENSEARCH_INSTANCE_PRICE: Record<string, number> = {
  't3.small.search': 0.056,
  't3.medium.search': 0.112,
  'm7g.medium.search': 0.085,
  'm8g.medium.search': 0.094,
};
const GP3_PER_GB_MONTH = 0.1464;
const SERVERLESS_OCU_HOUR = 0.281;
const HOURS_PER_MONTH = 730;

export interface Billable {
  service: string;
  name: string;
  detail: string;
  /** Estimated USD per hour, when we know the price. */
  perHour?: number;
  expected?: boolean;
}

const LIVE_STACK_STATUSES: StackStatus[] = [
  'CREATE_IN_PROGRESS',
  'CREATE_COMPLETE',
  'CREATE_FAILED',
  'ROLLBACK_IN_PROGRESS',
  'ROLLBACK_COMPLETE',
  'ROLLBACK_FAILED',
  'UPDATE_IN_PROGRESS',
  'UPDATE_COMPLETE',
  'UPDATE_ROLLBACK_COMPLETE',
  'UPDATE_ROLLBACK_FAILED',
  'DELETE_IN_PROGRESS',
  'DELETE_FAILED',
  'REVIEW_IN_PROGRESS',
  'IMPORT_COMPLETE',
];

export async function projectStacks(): Promise<{ name: string; status: string }[]> {
  const cfn = new CloudFormationClient({ region: REGION });
  const stacks: { name: string; status: string }[] = [];
  let NextToken: string | undefined;
  do {
    const page = await cfn.send(
      new ListStacksCommand({ StackStatusFilter: LIVE_STACK_STATUSES, NextToken }),
    );
    for (const s of page.StackSummaries ?? []) {
      if (s.StackName?.startsWith(STACK_PREFIX)) {
        stacks.push({ name: s.StackName, status: s.StackStatus ?? '?' });
      }
    }
    NextToken = page.NextToken;
  } while (NextToken);
  return stacks.sort((a, b) => a.name.localeCompare(b.name));
}

/** Resources billed by the hour (or similar) anywhere in the region, not only this project's. */
export async function hourlyBillable(): Promise<Billable[]> {
  const found = await Promise.all([
    openSearchDomains(),
    serverlessCollections(),
    natGateways(),
    runningInstances(),
    bedrockProvisionedThroughput(),
  ]);
  return found.flat();
}

async function openSearchDomains(): Promise<Billable[]> {
  const os = new OpenSearchClient({ region: REGION });
  const names = (await os.send(new ListDomainNamesCommand({}))).DomainNames ?? [];
  if (names.length === 0) return [];
  const { DomainStatusList = [] } = await os.send(
    new DescribeDomainsCommand({ DomainNames: names.map((d) => d.DomainName ?? '') }),
  );
  return DomainStatusList.map((d) => {
    const type = d.ClusterConfig?.InstanceType ?? '?';
    const count = d.ClusterConfig?.InstanceCount ?? 1;
    const gb = (d.EBSOptions?.VolumeSize ?? 0) * count;
    const instancePrice = OPENSEARCH_INSTANCE_PRICE[type];
    return {
      service: 'OpenSearch domain',
      name: d.DomainName ?? '?',
      detail: `${count} x ${type}, ${gb} GB${d.Deleted ? ', deleting' : ''}`,
      perHour:
        instancePrice === undefined
          ? undefined
          : instancePrice * count + (gb * GP3_PER_GB_MONTH) / HOURS_PER_MONTH,
      expected: d.DomainName === EXPECTED_DOMAIN,
    };
  });
}

async function serverlessCollections(): Promise<Billable[]> {
  const aoss = new OpenSearchServerlessClient({ region: REGION });
  const { collectionSummaries = [] } = await aoss.send(new ListCollectionsCommand({}));
  return collectionSummaries.map((c) => ({
    service: 'OpenSearch Serverless',
    name: c.name ?? '?',
    detail: `${c.status}; minimum about 1-2 OCU`,
    perHour: SERVERLESS_OCU_HOUR,
  }));
}

async function natGateways(): Promise<Billable[]> {
  const ec2 = new EC2Client({ region: REGION });
  const { NatGateways = [] } = await ec2.send(
    new DescribeNatGatewaysCommand({
      Filter: [{ Name: 'state', Values: ['pending', 'available'] }],
    }),
  );
  return NatGateways.map((n) => ({
    service: 'NAT gateway',
    name: n.NatGatewayId ?? '?',
    detail: n.State ?? '',
  }));
}

async function runningInstances(): Promise<Billable[]> {
  const ec2 = new EC2Client({ region: REGION });
  const { Reservations = [] } = await ec2.send(
    new DescribeInstancesCommand({
      Filters: [{ Name: 'instance-state-name', Values: ['pending', 'running'] }],
    }),
  );
  return Reservations.flatMap((r) => r.Instances ?? []).map((i) => ({
    service: 'EC2 instance',
    name: i.InstanceId ?? '?',
    detail: i.InstanceType ?? '',
  }));
}

async function bedrockProvisionedThroughput(): Promise<Billable[]> {
  const bedrock = new BedrockClient({ region: REGION });
  const { provisionedModelSummaries = [] } = await bedrock.send(
    new ListProvisionedModelThroughputsCommand({}),
  );
  return provisionedModelSummaries.map((p) => ({
    service: 'Bedrock provisioned throughput',
    name: p.provisionedModelName ?? '?',
    detail: `${p.status}, ${p.modelUnits} model units`,
  }));
}

/** Account- or region-wide settings this project changes, which outlive its stacks. */
export async function accountSettings(): Promise<{ name: string; value: string }[]> {
  const bedrock = new BedrockClient({ region: REGION });
  const apigw = new APIGatewayClient({ region: REGION });
  const [logging, account] = await Promise.all([
    bedrock.send(new GetModelInvocationLoggingConfigurationCommand({})),
    apigw.send(new GetAccountCommand({})),
  ]);
  const logGroup = logging.loggingConfig?.cloudWatchConfig?.logGroupName;
  return [
    { name: 'Bedrock invocation logging', value: logGroup ? `on → ${logGroup}` : 'off' },
    {
      name: 'API Gateway CloudWatch role',
      value: account.cloudwatchRoleArn ? 'set' : 'not set',
    },
  ];
}

/** Log groups for this project that a stack deletion may have left behind. */
export async function leftoverLogGroups(): Promise<string[]> {
  const logs = new CloudWatchLogsClient({ region: REGION });
  const names: string[] = [];
  for (const prefix of [STACK_PREFIX, `/aws/lambda/${STACK_PREFIX}`]) {
    let nextToken: string | undefined;
    do {
      const page = await logs.send(
        new DescribeLogGroupsCommand({ logGroupNamePrefix: prefix, nextToken }),
      );
      names.push(...(page.logGroups ?? []).map((g) => g.logGroupName ?? ''));
      nextToken = page.nextToken;
    } while (nextToken);
  }
  return names;
}

/**
 * Anything still carrying the project tag. The tagging API can lag by a few minutes after a
 * deletion, so treat this as a list to check, not proof something still exists.
 */
export async function taggedResources(): Promise<string[]> {
  const tagging = new ResourceGroupsTaggingAPIClient({ region: REGION });
  const arns: string[] = [];
  let PaginationToken: string | undefined;
  do {
    const page = await tagging.send(
      new GetResourcesCommand({
        TagFilters: [{ Key: PROJECT_TAG.key, Values: [PROJECT_TAG.value] }],
        PaginationToken,
      }),
    );
    arns.push(...(page.ResourceTagMappingList ?? []).map((r) => r.ResourceARN ?? ''));
    PaginationToken = page.PaginationToken || undefined;
  } while (PaginationToken);
  return arns;
}
