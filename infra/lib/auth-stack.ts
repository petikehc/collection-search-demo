import {
  Aws,
  CfnOutput,
  Duration,
  Fn,
  RemovalPolicy,
  SecretValue,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import { Alarm, ComparisonOperator, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import {
  AccountRecovery,
  CfnManagedLoginBranding,
  FeaturePlan,
  ManagedLoginVersion,
  OAuthScope,
  ResourceServerScope,
  UserPool,
  type UserPoolClient,
  UserPoolClientIdentityProvider,
  UserPoolOperation,
  VerificationEmailStyle,
} from 'aws-cdk-lib/aws-cognito';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import {
  CLI_CALLBACK_URL,
  RESOURCE_SERVER,
  SCOPES,
  WEB_ORIGINS,
  webCallbackUrl,
  webLogoutUrl,
} from '../../functions/lib/auth/constants.js';
import { LAMBDA_DEFAULTS } from './lambda-defaults.js';
import { ALARM_EMAIL_PARAMETER } from './monitoring.js';
import { FUNCTIONS_DIR } from './opensearch-role.js';

/** Sign-ups in a day that suggest scripts rather than people (each one also sends an email). */
export const SIGN_UP_ALARM_PER_DAY = 20;

/**
 * Cognito user pool for bookmarks (search and Ask need no sign-in). Anyone can sign up on
 * Cognito's managed login pages (email and password, confirmed with an emailed code); sign-in
 * is the authorisation code grant with PKCE. The owner is emailed about each new account.
 * API Gateway checks the access token's scopes. `pnpm user:create` still invites someone directly.
 */
export class AuthStack extends Stack {
  readonly userPool: UserPool;
  /** For the hosted web front end (WebStack). */
  readonly loginBaseUrl: string;
  readonly webClientSecret: Secret;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, { description: 'Collection search: Cognito sign-in', ...props });

    this.userPool = new UserPool(this, 'Users', {
      userPoolName: 'collection-search',
      // Essentials: managed login v2 (needs more than Lite); 10,000 MAU/month free.
      featurePlan: FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: true,
      // Cognito's own sender (no SES): up to 50 emails a day, which also bounds how many
      // confirmation codes a script could send to strangers' addresses.
      userVerification: {
        emailStyle: VerificationEmailStyle.CODE,
        emailSubject: 'Your Collection Search Demo code',
        emailBody: 'Your confirmation code for Collection Search Demo is {####}',
      },
      signInAliases: { email: true },
      autoVerify: { email: true },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      passwordPolicy: { minLength: 12, tempPasswordValidity: Duration.days(3) },
      // A demo: deleting the stack deletes the users. In production: RETAIN plus deletion protection.
      removalPolicy: RemovalPolicy.DESTROY,
      deletionProtection: false,
    });

    // The prefix must be unique per region. The suffix comes from the stack's ID (a UUID),
    // so it's stable for this stack and never reveals the account.
    const suffix = Fn.select(0, Fn.split('-', Fn.select(2, Fn.split('/', Aws.STACK_ID))));
    const domain = this.userPool.addDomain('LoginDomain', {
      cognitoDomain: { domainPrefix: Fn.join('-', ['collection-search', suffix]) },
      managedLoginVersion: ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    const bookmarks = new ResourceServerScope({
      scopeName: SCOPES.bookmarks,
      scopeDescription: 'Read and change your bookmarks',
    });
    const api = this.userPool.addResourceServer('Api', {
      identifier: RESOURCE_SERVER,
      userPoolResourceServerName: 'Collection search API',
      scopes: [bookmarks],
    });
    const scopes = [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.resourceServer(api, bookmarks)];

    // Shared by both clients: code grant only (no implicit), managed login only (no direct
    // password API calls from the apps), short-lived access tokens.
    const common = {
      authFlows: { userSrp: true },
      supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(1),
    };

    // The Astro server: a confidential client. Its secret stays on the server, in Secrets Manager.
    const web = this.userPool.addClient('WebClient', {
      ...common,
      userPoolClientName: 'web',
      generateSecret: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes,
        callbackUrls: WEB_ORIGINS.map(webCallbackUrl),
        logoutUrls: WEB_ORIGINS.map(webLogoutUrl),
      },
    });
    const webSecret = new Secret(this, 'WebClientSecret', {
      description: 'Cognito app client ID and secret for the collection search web front end',
      secretObjectValue: {
        clientId: SecretValue.unsafePlainText(web.userPoolClientId),
        clientSecret: web.userPoolClientSecret,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Command-line tools: a public client (a secret on a laptop isn't a secret), so PKCE is
    // what stops a stolen authorisation code being exchanged by anyone else.
    const cli = this.userPool.addClient('CliClient', {
      ...common,
      userPoolClientName: 'cli',
      generateSecret: false,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes,
        callbackUrls: [CLI_CALLBACK_URL],
      },
    });

    // Managed login v2 shows a page only for app clients with a style; these use Cognito's default.
    for (const [name, client] of [
      ['WebLoginStyle', web],
      ['CliLoginStyle', cli],
    ] as [string, UserPoolClient][]) {
      const style = new CfnManagedLoginBranding(this, name, {
        userPoolId: this.userPool.userPoolId,
        clientId: client.userPoolClientId,
        useCognitoProvidedValues: true,
      });
      style.node.addDependency(domain);
    }

    // Sign-up notifications: a post-confirmation trigger publishes to this topic, which emails
    // the address in SSM (the same one alarms go to).
    const signUps = new Topic(this, 'SignUps', { displayName: 'Collection search sign-ups' });
    signUps.addSubscription(
      new EmailSubscription(StringParameter.valueForStringParameter(this, ALARM_EMAIL_PARAMETER)),
    );
    const notify = new NodejsFunction(this, 'SignUpNotifier', {
      description: 'Cognito post-confirmation trigger: emails the owner about each new account',
      ...LAMBDA_DEFAULTS,
      entry: `${FUNCTIONS_DIR}sign-up/handler.ts`,
      memorySize: 256,
      timeout: Duration.seconds(5),
      logGroup: new LogGroup(this, 'SignUpNotifierLogs'),
      environment: { ...LAMBDA_DEFAULTS.environment, SIGN_UPS_TOPIC_ARN: signUps.topicArn },
    });
    signUps.grantPublish(notify);
    this.userPool.addTrigger(UserPoolOperation.POST_CONFIRMATION, notify);

    // Many sign-ups in a day suggests scripts: each one also sent an email to someone.
    new Alarm(this, 'ManySignUps', {
      alarmDescription: `More than ${SIGN_UP_ALARM_PER_DAY} sign-ups today: probably scripts, not people`,
      metric: signUps.metricNumberOfMessagesPublished({
        period: Duration.days(1),
        statistic: 'Sum',
      }),
      threshold: SIGN_UP_ALARM_PER_DAY,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new SnsAction(signUps));

    this.loginBaseUrl = domain.baseUrl();
    this.webClientSecret = webSecret;

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'Issuer', { value: this.userPool.userPoolProviderUrl });
    new CfnOutput(this, 'LoginBaseUrl', { value: domain.baseUrl() });
    new CfnOutput(this, 'WebClientId', { value: web.userPoolClientId });
    new CfnOutput(this, 'WebClientSecretArn', { value: webSecret.secretArn });
    new CfnOutput(this, 'CliClientId', { value: cli.userPoolClientId });
  }
}
