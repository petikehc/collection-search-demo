import { defineMiddleware } from 'astro:middleware';
import { clientKey, RateLimiter } from './lib/rate-limit.js';
import { currentUser } from './lib/session.js';

// Per address, per minute, in each server instance (lib/rate-limit.ts). Answers are the only
// requests that cost real money, so they get the tightest limit.
const MINUTE = 60_000;
const limits = {
  answers: new RateLimiter(6, MINUTE),
  posts: new RateLimiter(20, MINUTE),
  pages: new RateLimiter(60, MINUTE),
};

/** Pages that need a signed-in user. API Gateway checks the token again; this is for the UI. */
const PROTECTED = ['/bookmarks'];

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, cookies, locals, redirect, request } = context;

  if (!url.pathname.startsWith('/_astro/')) {
    let fallback: string | undefined;
    try {
      fallback = context.clientAddress;
    } catch {
      // not available in every environment
    }
    const key = clientKey(request.headers, fallback);
    const limiter = url.pathname.startsWith('/_server-islands/')
      ? limits.answers
      : request.method === 'GET' || request.method === 'HEAD'
        ? limits.pages
        : limits.posts;
    const verdict = limiter.hit(key);
    if (!verdict.allowed && limiter === limits.answers) {
      // Astro swaps an island's placeholder only for a 200 with HTML: anything else would
      // leave "Writing an answer…" on screen for good. So the refusal is the island's content.
      return new Response(
        '<p class="message warn" role="status">Too many questions at once from your connection. Please wait a minute, then search again.</p>',
        {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        },
      );
    }
    if (!verdict.allowed) {
      return new Response('Too many requests. Please slow down and try again in a minute.', {
        status: 429,
        headers: {
          'retry-after': String(verdict.retryAfter),
          'content-type': 'text/plain; charset=utf-8',
        },
      });
    }
  }

  // Astro's origin check refuses a cross-site POST but lets one with no Origin header through.
  // Browsers always send Origin on a POST; scripts and crawlers often don't, and a POST here can
  // spend the shared allowance of AI answers. (A bot can fake the header: the allowance and the
  // rate limit are the real bounds. This stops the naive ones for free.)
  if (!['GET', 'HEAD'].includes(request.method) && !request.headers.get('origin')) {
    return new Response('Forbidden', { status: 403 });
  }

  // Auth routes manage the session themselves; static assets need no user.
  if (!url.pathname.startsWith('/auth/') && !url.pathname.startsWith('/_astro/')) {
    locals.user = await currentUser(cookies, url);
  }

  // GET only: a signed-out POST (a bookmark clicked) is handled by the page, which keeps the
  // bookmark through sign-in.
  const isProtected = PROTECTED.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`));
  if (isProtected && !locals.user && request.method === 'GET') {
    return redirect(`/auth/login?returnTo=${encodeURIComponent(url.pathname + url.search)}`);
  }

  const response = await next();
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  // Never framed by another site (clickjacking).
  response.headers.set('x-frame-options', 'DENY');
  // Hosted over HTTPS only: browsers should never try plain http for a year (not on localhost).
  if (url.protocol === 'https:') {
    response.headers.set('strict-transport-security', 'max-age=31536000');
  }
  // Signed-in pages are personal: keep them out of shared caches and the back/forward cache.
  if (locals.user) response.headers.set('cache-control', 'private, no-store');
  return response;
});
