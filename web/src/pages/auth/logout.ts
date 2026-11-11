import type { APIRoute } from 'astro';
import { logout } from '../../lib/session.js';

/** POST only, so another site can't sign you out with a link or an image tag. */
export const POST: APIRoute = async ({ cookies, url, redirect }) => {
  return redirect((await logout(cookies, url)).toString());
};
