import type { APIRoute } from 'astro';
import { NOTICE_COOKIE } from '../lib/notice.js';
import { safeReturnTo } from '../lib/session.js';

/** Dismisses the first-visit cultural notice; the footer keeps showing it on every page. */
export const POST: APIRoute = async ({ cookies, request, url, redirect }) => {
  const form = await request.formData();
  cookies.set(NOTICE_COOKIE, 'dismissed', {
    path: '/',
    maxAge: 365 * 24 * 3600,
    sameSite: 'lax',
    httpOnly: true,
    secure: url.protocol === 'https:',
  });
  return redirect(safeReturnTo(String(form.get('returnTo') ?? '/')), 303);
};
