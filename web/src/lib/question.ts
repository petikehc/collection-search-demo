export { looksLikeQuestion } from '../../../functions/lib/search/question.js';

/**
 * Was this page load a person's action (typing and submitting, or clicking a link)? Browsers
 * send `Sec-Fetch-User: ?1` only on navigations a user triggered, and scripts can't set it.
 * Crawlers following links don't send it. A bot can fake it, so this decides when an answer
 * loads by itself, not whether one can be had: the daily allowance is the real bound (ADR 15).
 */
export function isPersonsAction(headers: Headers): boolean {
  return headers.get('sec-fetch-user') === '?1';
}
