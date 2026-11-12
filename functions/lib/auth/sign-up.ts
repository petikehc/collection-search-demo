/** What Cognito sends a post-confirmation trigger (the fields used here). */
export interface PostConfirmationEvent {
  triggerSource: string;
  userPoolId: string;
  request: { userAttributes: Record<string, string | undefined> };
}

/**
 * The notification for a new account, or undefined when there's nothing to tell: the same
 * trigger also runs when an existing user confirms a password reset.
 */
export function signUpNotification(
  event: PostConfirmationEvent,
  now: Date,
): { subject: string; message: string } | undefined {
  if (event.triggerSource !== 'PostConfirmation_ConfirmSignUp') return undefined;
  const email = event.request.userAttributes.email ?? '(no email address)';
  return {
    subject: 'Collection Search Demo: new sign-up',
    message: [
      `${email} signed up and confirmed their email address.`,
      '',
      `Time: ${now.toISOString()}`,
      `User pool: ${event.userPoolId}`,
      '',
      'To remove the account: aws cognito-idp admin-delete-user --user-pool-id <pool> --username <email>',
    ].join('\n'),
  };
}
