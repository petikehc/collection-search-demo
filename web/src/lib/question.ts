/**
 * Does the search box text look like a question (worth an AI answer) rather than keywords?
 * A question mark, a question word at the start, or a longer phrase.
 */
const QUESTION_START =
  /^(what|whats|what's|how|why|who|whose|when|where|which|is|are|was|were|can|could|did|do|does|should|tell me|show me|explain|describe|list)\b/i;

export function looksLikeQuestion(text: string | undefined): boolean {
  const q = text?.trim() ?? '';
  if (q.length < 3) return false;
  if (q.endsWith('?')) return true;
  if (QUESTION_START.test(q)) return true;
  return q.split(/\s+/).length >= 6;
}

/**
 * Was this page load a person's action (typing and submitting, or clicking a link)? Browsers
 * send `Sec-Fetch-User: ?1` only on navigations a user triggered, and scripts can't set it.
 * Crawlers following links don't send it. A bot can fake it, so this decides when an answer
 * loads by itself, not whether one can be had: the daily allowance is the real bound (ADR 15).
 */
export function isPersonsAction(headers: Headers): boolean {
  return headers.get('sec-fetch-user') === '?1';
}
