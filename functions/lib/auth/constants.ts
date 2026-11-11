/** Cognito resource server identifier: access tokens carry scopes as `collection-search/<scope>`. */
export const RESOURCE_SERVER = 'collection-search';
export const SCOPES = { ask: 'ask', favourites: 'favourites' } as const;

/** Local only: the Astro dev server, and the loopback port the command-line tools listen on. */
export const WEB_CALLBACK_URL = 'http://localhost:4321/auth/callback';
export const WEB_LOGOUT_URL = 'http://localhost:4321/';
export const CLI_CALLBACK_URL = 'http://localhost:8976/callback';
