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
} from 'aws-cdk-lib/aws-cognito';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';
import {
  CLI_CALLBACK_URL,
  RESOURCE_SERVER,
  SCOPES,
  WEB_CALLBACK_URL,
  WEB_LOGOUT_URL,
} from '../../functions/lib/auth/constants.js';

/**
 * Cognito user pool for signing in to Ask and favourites. Users sign in on Cognito's managed
 * login pages (authorisation code grant with PKCE); there's no sign-up page: an admin creates
 * each user with `pnpm user:create`. API Gateway checks the access token's scopes.
 */
export class AuthStack extends Stack {
  readonly userPool: UserPool;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, { description: 'Collection search: Cognito sign-in', ...props });

    this.userPool = new UserPool(this, 'Users', {
      userPoolName: 'collection-search',
      // Essentials: managed login v2 (needs more than Lite); 10,000 MAU/month free.
      featurePlan: FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: false,
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

    const ask = new ResourceServerScope({
      scopeName: SCOPES.ask,
      scopeDescription: 'Ask questions about the collection',
    });
    const favourites = new ResourceServerScope({
      scopeName: SCOPES.favourites,
      scopeDescription: 'Read and change your favourites',
    });
    const api = this.userPool.addResourceServer('Api', {
      identifier: RESOURCE_SERVER,
      userPoolResourceServerName: 'Collection search API',
      scopes: [ask, favourites],
    });
    const scopes = [
      OAuthScope.OPENID,
      OAuthScope.EMAIL,
      OAuthScope.resourceServer(api, ask),
      OAuthScope.resourceServer(api, favourites),
    ];

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
        callbackUrls: [WEB_CALLBACK_URL],
        logoutUrls: [WEB_LOGOUT_URL],
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

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'Issuer', { value: this.userPool.userPoolProviderUrl });
    new CfnOutput(this, 'LoginBaseUrl', { value: domain.baseUrl() });
    new CfnOutput(this, 'WebClientId', { value: web.userPoolClientId });
    new CfnOutput(this, 'WebClientSecretArn', { value: webSecret.secretArn });
    new CfnOutput(this, 'CliClientId', { value: cli.userPoolClientId });
  }
}
