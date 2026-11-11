/**
 * Everything the server needs, read once at startup:
 * - hosted (Lambda): from environment variables the Web stack sets;
 * - local (`pnpm web`): from the deployed stacks' outputs, using AWS_PROFILE's credentials.
 * Secret values always come from Secrets Manager at run time: the environment and files only
 * ever hold the secrets' ARNs, so there's no .env with secrets to leak.
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

/** The names match the stack outputs, so both sources are read the same way. */
type Settings = Record<
  'ApiUrl' | 'ApiKeySecretArn' | 'LoginBaseUrl' | 'UserPoolId' | 'WebClientSecretArn',
  string
>;

async function load(): Promise<Config> {
  const settings = process.env.API_URL ? fromEnvironment() : await fromStackOutputs();
  const [apiKey, client] = await Promise.all([
    secret(settings.ApiKeySecretArn),
    secret(settings.WebClientSecretArn),
  ]);
  const { clientId, clientSecret } = JSON.parse(client) as Record<string, string>;
  return {
    apiUrl: settings.ApiUrl,
    apiKey,
    loginBaseUrl: settings.LoginBaseUrl,
    userPoolId: settings.UserPoolId,
    clientId: clientId ?? '',
    clientSecret: clientSecret ?? '',
  };
}

function fromEnvironment(): Settings {
  const env = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`Environment variable ${name} is missing`);
    return value;
  };
  return {
    ApiUrl: env('API_URL'),
    ApiKeySecretArn: env('API_KEY_SECRET_ARN'),
    LoginBaseUrl: env('LOGIN_BASE_URL'),
    UserPoolId: env('USER_POOL_ID'),
    WebClientSecretArn: env('WEB_CLIENT_SECRET_ARN'),
  };
}

async function fromStackOutputs(): Promise<Settings> {
  const [auth, api] = await Promise.all([
    outputs('CollectionSearch-Auth'),
    outputs('CollectionSearch-Api'),
  ]);
  return {
    ApiUrl: required(api, 'ApiUrl'),
    ApiKeySecretArn: required(api, 'ApiKeySecretArn'),
    LoginBaseUrl: required(auth, 'LoginBaseUrl'),
    UserPoolId: required(auth, 'UserPoolId'),
    WebClientSecretArn: required(auth, 'WebClientSecretArn'),
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
