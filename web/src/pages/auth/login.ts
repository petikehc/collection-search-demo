import type { APIRoute } from 'astro';
import { startLogin } from '../../lib/session.js';

/** GET /auth/login?returnTo=/ask → Cognito managed login. */
export const GET: APIRoute = async ({ cookies, url, redirect }) => {
  const target = await startLogin(cookies, url, url.searchParams.get('returnTo') ?? '/');
  return redirect(target.toString());
};
