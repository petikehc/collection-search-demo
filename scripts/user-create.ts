/**
 * Creates a user in the Cognito user pool (self sign-up is off, so this is the only way in).
 * Cognito emails them a temporary password; managed login asks for a new one at first sign-in.
 * The address is only ever an argument: it's not stored in the repo.
 *
 *   pnpm user:create you@example.org
 *   pnpm user:create you@example.org --resend     (temporary password expired or lost)
 */
import {
  AdminCreateUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { getStackOutputs, REGION } from './lib/stack-outputs.js';

const [email, flag] = process.argv.slice(2);
if (!email?.includes('@')) throw new Error('Usage: pnpm user:create <email> [--resend]');

const { UserPoolId } = await getStackOutputs('CollectionSearch-Auth');
const cognito = new CognitoIdentityProviderClient({ region: REGION });

await cognito.send(
  new AdminCreateUserCommand({
    UserPoolId,
    Username: email,
    // The admin vouches for the address, so the user isn't asked to verify it again.
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'email_verified', Value: 'true' },
    ],
    DesiredDeliveryMediums: ['EMAIL'],
    MessageAction: flag === '--resend' ? 'RESEND' : undefined,
  }),
);
console.log(`Emailed a temporary password to ${email}. Sign in with: pnpm ask "a question"`);
