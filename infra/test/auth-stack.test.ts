import { readFileSync } from 'node:fs';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { WEB_DOMAIN } from '../../functions/lib/auth/constants.js';
import { AuthStack } from '../lib/auth-stack.js';

const { context } = JSON.parse(readFileSync(new URL('../cdk.json', import.meta.url), 'utf8'));
const env = { account: '111111111111', region: 'ap-southeast-2' };

describe('AuthStack', () => {
  const template = Template.fromStack(new AuthStack(new App({ context }), 'Auth', { env }));
  const clients = Object.values(template.findResources('AWS::Cognito::UserPoolClient')).map(
    (c) => c.Properties,
  );
  const client = (name: string) => clients.find((c) => c.ClientName === name);

  it('has no sign-up page: only an admin can create users', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      UserPoolTier: 'ESSENTIALS',
      UsernameAttributes: ['email'],
    });
  });

  it('uses managed login v2 on a neutral domain prefix', () => {
    const [domain] = Object.values(template.findResources('AWS::Cognito::UserPoolDomain'));
    expect(domain?.Properties.ManagedLoginVersion).toBe(2);
    expect(JSON.stringify(domain?.Properties.Domain)).toContain('collection-search');
    // A style per app client, or managed login shows no page for it.
    template.resourceCountIs('AWS::Cognito::ManagedLoginBranding', 2);
  });

  it('defines the favourites scope on the API resource server (Ask needs no sign-in)', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolResourceServer', {
      Identifier: 'collection-search',
      Scopes: [Match.objectLike({ ScopeName: 'favourites' })],
    });
  });

  it('sends the web client back only to localhost or the hosted site, over HTTPS there', () => {
    expect(client('web')?.CallbackURLs).toEqual([
      'http://localhost:4321/auth/callback',
      `https://${WEB_DOMAIN}/auth/callback`,
    ]);
    expect(client('web')?.LogoutURLs).toEqual(['http://localhost:4321/', `https://${WEB_DOMAIN}/`]);
    expect(client('cli')?.CallbackURLs).toEqual(['http://localhost:8976/callback']);
  });

  it('allows only the authorisation code grant for both clients', () => {
    for (const c of clients) {
      expect(c.AllowedOAuthFlows).toEqual(['code']);
      expect(c.SupportedIdentityProviders).toEqual(['COGNITO']);
      // Resource-server scopes are `<identifier>/<scope>`, built from a reference to the server.
      const server = { Ref: expect.stringMatching(/^UsersApi/) };
      expect(c.AllowedOAuthScopes).toEqual([
        'openid',
        'email',
        { 'Fn::Join': ['', [server, '/favourites']] },
      ]);
    }
  });

  it('gives the web server a secret, and the command-line client none (PKCE instead)', () => {
    expect(client('web')?.GenerateSecret).toBe(true);
    expect(client('cli')?.GenerateSecret).toBe(false);
    // The secret goes to Secrets Manager via a reference, never as a literal in the template.
    const [secret] = Object.values(template.findResources('AWS::SecretsManager::Secret'));
    expect(JSON.stringify(secret?.Properties.SecretString)).toContain('Fn::GetAtt');
  });
});
