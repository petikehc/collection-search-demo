/**
 * Everything the server needs, read once at startup from the deployed stacks (their outputs) and
 * Secrets Manager, using the AWS credentials of whoever runs the server (AWS_PROFILE). Nothing
 * is copied into files, so there's no .env with secrets to leak.
 */
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const REGION = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'ap-southeast-2';

export interface Config {
  apiUrl: string;
  apiKey: string;
  loginBaseUrl: string;
  userPoolId: string;
  clientId: string;
  clientSecret: string;
}

let config: Promise<Config> | undefined;

export function getConfig(): Promise<Config> {
  config ??= load().catch((err) => {
    config = undefined; // let the next request try again, e.g. after `aws sso login`
    throw err;
  });
  return config;
}

async function load(): Promise<Config> {
  const [auth, api] = await Promise.all([
    outputs('CollectionSearch-Auth'),
    outputs('CollectionSearch-Api'),
  ]);
  const [apiKey, client] = await Promise.all([
    secret(required(api, 'ApiKeySecretArn')),
    secret(required(auth, 'WebClientSecretArn')),
  ]);
  const { clientId, clientSecret } = JSON.parse(client) as Record<string, string>;
  return {
    apiUrl: required(api, 'ApiUrl'),
    apiKey,
    loginBaseUrl: required(auth, 'LoginBaseUrl'),
    userPoolId: required(auth, 'UserPoolId'),
    clientId: clientId ?? '',
    clientSecret: clientSecret ?? '',
  };
}

async function outputs(stackName: string): Promise<Record<string, string>> {
  const cfn = new CloudFormationClient({ region: REGION });
  const { Stacks } = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
  return Object.fromEntries(
    (Stacks?.[0]?.Outputs ?? []).map((o) => [o.OutputKey ?? '', o.OutputValue ?? '']),
  );
}

async function secret(arn: string): Promise<string> {
  const sm = new SecretsManagerClient({ region: REGION });
  const { SecretString } = await sm.send(new GetSecretValueCommand({ SecretId: arn }));
  if (!SecretString) throw new Error(`Secret ${arn} is empty`);
  return SecretString;
}

function required(outputs: Record<string, string>, key: string): string {
  const value = outputs[key];
  if (!value) throw new Error(`Stack output ${key} is missing: deploy the stacks first`);
  return value;
}
