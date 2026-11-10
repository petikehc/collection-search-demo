import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';

export const REGION = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'ap-southeast-2';

/** Reads a deployed stack's outputs, so scripts never hard-code endpoints, ARNs or account IDs. */
export async function getStackOutputs(stackName: string): Promise<Record<string, string>> {
  const cfn = new CloudFormationClient({ region: REGION });
  const { Stacks } = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
  const outputs = Stacks?.[0]?.Outputs ?? [];
  return Object.fromEntries(outputs.map((o) => [o.OutputKey ?? '', o.OutputValue ?? '']));
}
