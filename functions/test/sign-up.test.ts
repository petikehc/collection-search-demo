import { describe, expect, it } from 'vitest';
import { signUpNotification } from '../lib/auth/sign-up.js';

const event = (triggerSource: string) => ({
  triggerSource,
  userPoolId: 'ap-southeast-2_example',
  request: { userAttributes: { email: 'new.person@example.org', sub: 'abc' } },
});
const now = new Date('2026-11-12T03:00:00Z');

describe('signUpNotification', () => {
  it('tells the owner who signed up and when', () => {
    const n = signUpNotification(event('PostConfirmation_ConfirmSignUp'), now);
    expect(n?.subject).toBe('Collection Search Demo: new sign-up');
    expect(n?.message).toContain('new.person@example.org signed up');
    expect(n?.message).toContain('2026-11-12T03:00:00.000Z');
  });

  it('says nothing when an existing user confirms a password reset', () => {
    expect(
      signUpNotification(event('PostConfirmation_ConfirmForgotPassword'), now),
    ).toBeUndefined();
  });
});
