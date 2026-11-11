import { defineMiddleware } from 'astro:middleware';
import { currentUser } from './lib/session.js';

/** Pages that need a signed-in user. API Gateway checks the token again; this is for the UI. */
const PROTECTED = ['/ask', '/favourites'];

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, cookies, locals, redirect } = context;

  // Auth routes manage the session themselves; static assets need no user.
  if (!url.pathname.startsWith('/auth/') && !url.pathname.startsWith('/_astro/')) {
    locals.user = await currentUser(cookies, url);
  }

  const isProtected = PROTECTED.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`));
  if (isProtected && !locals.user) {
    return redirect(`/auth/login?returnTo=${encodeURIComponent(url.pathname + url.search)}`);
  }

  const response = await next();
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  // Never framed by another site (clickjacking).
  response.headers.set('x-frame-options', 'DENY');
  // Signed-in pages are personal: keep them out of shared caches and the back/forward cache.
  if (locals.user) response.headers.set('cache-control', 'private, no-store');
  return response;
});
