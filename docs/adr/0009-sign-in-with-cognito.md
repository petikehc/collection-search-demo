# 9. Sign-in with Cognito: managed login, code grant with PKCE, scopes checked at the gateway

- Status: accepted
- Date: 2026-11-11

## Context

Ask calls a model on every request, so it costs money and needs abuse limits per person. Favourites are per-user data. Both need to know who is calling. Until now `/ask` was locked to IAM-signed requests (ADR 0007), which only works for people with AWS credentials.

What we need:

- users sign in without us handling passwords;
- no public sign-up (only invited users);
- the API decides what a caller may do, not just whether they're signed in;
- a web server and command-line tools can both get tokens.

## Options considered

1. **Cognito with our own sign-in form** (InitiateAuth from the app). Full control of the UI, but our server handles passwords, and every new factor (MFA, passkeys) is our code. Tokens from this flow don't carry custom resource-server scopes.
2. **Cognito managed login** (OAuth 2.0 / OIDC, authorisation code grant). Cognito hosts the sign-in pages, including password change, reset and MFA. The app only handles redirects and tokens.
3. **An external IdP** (Auth0, Entra ID, a museum's existing directory) federated into Cognito, or directly. The right answer when staff already have accounts; out of scope for a demo with no existing directory.

## Decision

**Option 2, Cognito managed login (v2), on the Essentials plan.**

**The user pool:**

- Self sign-up is off; `pnpm user:create <email>` creates a user, and Cognito emails a temporary password.
- Email is the username. The minimum password length is 12.
- The Essentials plan is required for managed login v2. The first 10,000 monthly active users are free.
- The domain prefix is neutral (`collection-search-<suffix>`). The suffix comes from the stack's ID, so it's unique without revealing the account.

**Two app clients, one per kind of app:**

| Client | Type                      | Why                                                                                                                                                                                          |
| ------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web`  | Confidential (has secret) | The Astro server can keep a secret: it's in Secrets Manager and never reaches the browser. The code exchange needs the secret **and** the PKCE verifier.                                     |
| `cli`  | Public (no secret)        | A secret shipped with a command-line tool isn't secret. PKCE alone stops an intercepted code being exchanged. It uses a loopback redirect (`http://localhost:8976`), as RFC 8252 recommends. |

Both clients:

- allow only the authorisation code grant (no implicit grant, which puts tokens in URLs);
- allow only localhost callback URLs;
- issue access tokens that last 1 hour and refresh tokens that last 1 day.

**Authorisation by scope, at the gateway.** A resource server `collection-search` defines two scopes, `ask` and `favourites`. Each API operation lists the scope it needs in `openapi.yaml`, and API Gateway's Cognito authoriser checks it before any Lambda runs:

- the token's signature, expiry and issuer;
- that the token is an **access** token. An ID token says who you are, not what an app may do on your behalf, so it can't be used.
- that it carries the operation's scope.

`/ask` and `/favourites` also require the API key (both in one security requirement, so **both** are needed). The usage plan's quota then caps every caller, signed in or not.

**The user's identity comes only from the verified token.** The favourites Lambda reads `sub` from the claims API Gateway passes in, never from the path or body. The table's partition key is `sub`, and the Lambda can only Query, Put and Delete, not Scan. A user can't ask for someone else's list, because there's no parameter to ask with.

## Verified on the deployed API

| Request                                                               | Result                |
| --------------------------------------------------------------------- | --------------------- |
| No token (with or without the API key)                                | 401                   |
| Valid access token with only `openid`, or only `ask` on `/favourites` | 401                   |
| Valid token with the right scope, no API key                          | 403                   |
| Right scope and API key: `/ask`, add, list, remove a favourite        | 200, 200, 200, 204    |
| A non-numeric object ID                                               | 400 (from the Lambda) |

A missing scope is a **401, not a 403**: API Gateway's Cognito authoriser treats it as an unauthorised token. The token is checked before the API key, so a missing token wins when both are missing.

## Consequences

- **Easier:**
  - Password storage, reset and MFA are Cognito's problem.
  - Adding a scope or a protected operation is a change to `openapi.yaml`.
  - Unauthorised calls are rejected before they cost a Lambda or model call.
- **Harder:**
  - The managed login pages only take limited branding.
  - Every app needs the redirect dance; `functions/lib/auth/oauth.ts` holds it once for the CLI and the web server.
- **The gateway doesn't check which app client a token came from.** Any client of the pool with the right scope is accepted. The web server checks the client ID (`aws-jwt-verify`) for its own sessions.
- **Revocation isn't instant.** API Gateway validates tokens locally, so a signed-out user's access token works until it expires (up to 1 hour). That's why access tokens are short-lived.
- **Demo-only settings to change for production:**
  - The user pool's removal policy is DESTROY with no deletion protection. In production: RETAIN plus deletion protection, since losing a user pool loses every account.
  - MFA is off. In production: required (TOTP or passkeys), which managed login handles without code changes.
  - Callback URLs are localhost only. A deployed site adds its HTTPS URL.
- **Machine clients:** the client credentials grant (for a partner system) would be a third client. Cognito charges per token request for that grant, with no free tier, so we didn't add one.
