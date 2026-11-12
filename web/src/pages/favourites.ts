import type { APIRoute } from 'astro';

/** Favourites were renamed bookmarks: old links and bookmarks still land in the right place. */
export const GET: APIRoute = ({ redirect }) => redirect('/bookmarks', 301);
