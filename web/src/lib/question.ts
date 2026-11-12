export { looksLikeQuestion } from '../../../functions/lib/search/question.js';

/**
 * Was this page reached by a person moving around this site (submitting the search box, or
 * clicking a link on one of our pages)? Browsers mark such navigations with
 * `Sec-Fetch-Site: same-origin` and `Sec-Fetch-Mode: navigate`, and scripts can't change them.
 * Crawlers and other tools fetching URLs send neither, and a link opened from elsewhere is
 * `cross-site` or `none`. (Not `Sec-Fetch-User`: Safari doesn't send it, so questions never
 * answered themselves there.) A bot driving a real browser can still pass this, so it decides
 * when an answer loads by itself, not whether one can be had: the daily allowance and the
 * per-address limit are the real bounds (ADR 15).
 */
export function isNavigationOnThisSite(headers: Headers): boolean {
  return (
    headers.get('sec-fetch-site') === 'same-origin' && headers.get('sec-fetch-mode') === 'navigate'
  );
}
