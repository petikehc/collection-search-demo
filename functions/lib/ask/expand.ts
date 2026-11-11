import objectsIndex from '../search/objects-index.json' with { type: 'json' };

/**
 * The keyword analyser's synonym rules (e.g. "spear thrower, spearthrower, woomera"), reused so
 * Ask and search share one list. Embeddings don't know these equivalences: "woomera" retrieved
 * look-alike words instead of the collection's spear-throwers.
 */
export const SYNONYM_RULES: string[][] = (
  objectsIndex.settings.analysis.filter.collection_synonyms.synonyms as string[]
).map((rule) => rule.split(',').map((term) => term.trim().toLowerCase()));

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Adds the other terms of any synonym rule the question mentions, e.g.
 * "What is a woomera?" → "What is a woomera? [search terms: spear thrower, spearthrower]".
 * Whole words only, with simple plurals, so substrings and unrelated words don't trigger it.
 */
export function expandQuestion(question: string, rules = SYNONYM_RULES): string {
  const lower = question.toLowerCase();
  const additions = new Set<string>();
  for (const rule of rules) {
    const mentioned = rule.filter((term) =>
      new RegExp(`\\b${escapeRegExp(term)}(s|es)?\\b`).test(lower),
    );
    if (mentioned.length === 0) continue;
    for (const term of rule) if (!mentioned.includes(term)) additions.add(term);
  }
  // Labelled as search terms, not "also known as": stated as a fact, the model repeated the
  // equivalence in answers, and the grounding check (rightly) found no source for it.
  return additions.size ? `${question} [search terms: ${[...additions].join(', ')}]` : question;
}
