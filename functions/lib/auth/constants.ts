/** Cognito resource server identifier: access tokens carry scopes as `collection-search/<scope>`. */
export const RESOURCE_SERVER = 'collection-search';
export const SCOPES = { ask: 'ask', favourites: 'favourites' } as const;

/** Where the web front end is hosted (docs/adr/0013-hosting-the-web-front-end.md). */
export const WEB_DOMAIN = 'collection-search.idoescode.com';

/** Every origin the web front end runs on: `pnpm web` locally, and the hosted site. */
export const WEB_ORIGINS = ['http://localhost:4321', `https://${WEB_DOMAIN}`];

/** Where Cognito sends the browser back after sign-in and sign-out, for one origin. */
export const webCallbackUrl = (origin: string) => `${origin}/auth/callback`;
export const webLogoutUrl = (origin: string) => `${origin}/`;

/** The loopback port the command-line tools listen on for sign-in. */
export const CLI_CALLBACK_URL = 'http://localhost:8976/callback';
