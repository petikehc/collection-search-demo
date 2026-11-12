import type { APIRoute } from 'astro';

/** Ask is now part of search: questions go in the same box. */
export const GET: APIRoute = ({ redirect }) => redirect('/', 301);
