/**
 * Does the search box text look like a question rather than keywords? A question mark, a
 * question word at the start, or a longer phrase. Shared by the search API (which ranks
 * questions by meaning) and the web site (which answers them).
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
