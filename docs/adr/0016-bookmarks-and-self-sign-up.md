# 16. Bookmarks, and self sign-up with an email to the owner for each account

- Status: accepted
- Date: 2026-11-12
- Changes: [ADR 9](0009-sign-in-with-cognito.md) (sign-up was invite-only; the `favourites` scope is now `bookmarks`)

## Context

With Ask open to everyone (ADR 15), the only feature behind sign-in is saving objects. Until now an account needed an invitation (`pnpm user:create`), so in practice nobody but the owner could try it.

The feature was also called "favourites". "Bookmarks" says what it does, and its icon is familiar from other sites.

## Options considered

1. **Keep invitations only.** Safe, but nobody else can try the feature.
2. **Self sign-up on Cognito's managed login pages:** email and password, confirmed with an emailed code. Cognito hosts the pages and sends the code. No new infrastructure.
3. **Passwordless sign-up** (an emailed code or link, no password). Less friction, but:
   - Cognito's managed login pages always ask for a password at sign-up;
   - passwordless email needs Amazon SES, which is in sandbox mode on this account (it can only email verified addresses until AWS approves production access);
   - a magic link would mean writing and owning the security-sensitive parts: three auth Lambdas, link signing and expiry.

## Decision

**Option 2, and the rename.**

- **Self sign-up:**
  - `selfSignUpEnabled` on the user pool. The managed login pages gain a "Sign up" link.
  - Email and password; the password policy stays at 12 characters minimum.
  - The address is confirmed with a code, sent by Cognito's own email sender (no SES).
  - `pnpm user:create` still works for inviting someone directly.
- **The owner is emailed about each new account:**
  - A post-confirmation trigger, a small Lambda, publishes to a new SNS topic. The topic emails the address in the SSM parameter that alarms already use.
  - It runs only for a confirmed sign-up, not when an existing user confirms a password reset.
  - It never blocks a sign-up: Cognito fails the confirmation if a trigger throws, so a failed notification is logged instead. The new user's address isn't logged.
- **An alarm on more than 20 sign-ups in a day,** to the same email. Each sign-up also sends a confirmation email to someone, so a burst suggests scripts.
- **The rename, everywhere:** the API (`/bookmarks`), the Cognito scope (`bookmarks`), the DynamoDB table, the Lambda, the web pages, and the alarm. `/favourites` on the web site redirects permanently to `/bookmarks`.

## What it costs

- **Cognito Essentials:** free up to 10,000 monthly active users.
- **Email:** Cognito's own sender is free.
- **SNS:** the first 1,000 email notifications a month are free.

## Consequences

- **Easier:**
  - Anyone can try bookmarks after one sign-up.
  - The owner sees every account as it's created, and can delete it with one command (in the email).
- **Harder:**
  - **Open sign-up can be used to send confirmation emails to strangers' addresses.** Cognito's own sender allows 50 emails a day, which bounds it; the alarm reports a burst. A CAPTCHA (AWS WAF on the user pool, about US$6 a month) is the next step if it happens.
  - **The rename replaced the table,** so the one saved favourite was lost, and every signed-in session had to sign in again, because tokens carried the old scope.
  - **Cognito's sender is meant for testing,** and its emails can land in spam (the first invitation did). SES with a verified domain would fix both, once AWS grants production access.
- **Revisit:** SES for email, if sign-ups grow or the codes go missing; MFA, which managed login supports without code changes.
