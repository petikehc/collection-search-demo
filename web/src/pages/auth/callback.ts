import type { APIRoute } from 'astro';
import { finishLogin } from '../../lib/session.js';

/** GET /auth/callback?code&state: Cognito sends the browser back here after sign-in. */
export const GET: APIRoute = async ({ cookies, url, redirect }) => {
  try {
    return redirect(await finishLogin(cookies, url));
  } catch (err) {
    console.error('sign-in failed:', (err as Error).message);
    return new Response(
      `${(err as Error).message}\n\nGo back to the home page and sign in again.`,
      {
        status: 400,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      },
    );
  }
};
