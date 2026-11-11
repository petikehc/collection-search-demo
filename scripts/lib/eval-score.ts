/** Scoring for `pnpm eval`: pure functions, unit-tested in scripts/test/eval-score.test.ts. */

export interface EvalCase {
  id: string;
  category: 'factual' | 'hard' | 'out-of-scope' | 'blocked';
  question: string;
  expect: 'answer' | 'not-covered' | 'blocked';
  expectedObjectIds?: string[];
  /** Broad topic: expectedObjectIds lists every relevant object in the sample, not a few targets. */
  broad?: boolean;
  mustNotMention?: string[];
}

export interface CaseResult {
  id: string;
  category: EvalCase['category'];
  expect: EvalCase['expect'];
  question: string;
  answer: string;
  blocked: boolean;
  retrievedIds: string[];
  citedIds: string[];
  /** Share of expected objects in the top-k retrieved (answer cases only). */
  recall?: number;
  /** At least one expected object retrieved. */
  hit?: boolean;
  expectationMet: boolean;
  faithfulness?: number;
  helpfulness?: number;
  judgeReason?: string;
  ms: number;
}

/** Share of expected objects found in the retrieved list, out of at most k (the top k can't hold more). */
export function recallAt(expected: string[], retrieved: string[], k = 6): number {
  if (expected.length === 0) return 1;
  const found = expected.filter((id) => retrieved.slice(0, k).includes(id)).length;
  return found / Math.min(expected.length, k);
}

/** Did the system behave as the case expects (answered, declined, or blocked)? */
export function expectationMet(c: EvalCase, answer: string, blocked: boolean): boolean {
  if (c.expect === 'blocked') return blocked;
  if (blocked) return c.expect === 'not-covered'; // declining an out-of-scope request is fine
  if (c.expect === 'not-covered') {
    const text = answer.toLowerCase();
    return !(c.mustNotMention ?? []).some((word) => text.includes(word.toLowerCase()));
  }
  return true;
}

/** Extracts the judge's JSON, tolerating text around it. Scores outside 1-5 are rejected. */
export function parseJudge(text: string): {
  faithfulness: number;
  helpfulness: number;
  reason: string;
} {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Judge returned no JSON: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(match[0]) as Record<string, unknown>;
  const score = (key: string) => {
    const n = Number(parsed[key]);
    if (!Number.isInteger(n) || n < 1 || n > 5)
      throw new Error(`Judge ${key} out of range: ${parsed[key]}`);
    return n;
  };
  return {
    faithfulness: score('faithfulness'),
    helpfulness: score('helpfulness'),
    reason: String(parsed.reason ?? ''),
  };
}

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : undefined;

export interface Summary {
  cases: number;
  expectationRate: number;
  meanRecall?: number;
  hitRate?: number;
  meanFaithfulness?: number;
  meanHelpfulness?: number;
}

export function summarise(results: CaseResult[]): Summary {
  const answerCases = results.filter((r) => r.recall !== undefined);
  return {
    cases: results.length,
    expectationRate: results.filter((r) => r.expectationMet).length / (results.length || 1),
    meanRecall: mean(answerCases.map((r) => r.recall ?? 0)),
    hitRate: mean(answerCases.map((r) => (r.hit ? 1 : 0))),
    meanFaithfulness: mean(results.flatMap((r) => (r.faithfulness ? [r.faithfulness] : []))),
    meanHelpfulness: mean(results.flatMap((r) => (r.helpfulness ? [r.helpfulness] : []))),
  };
}

/** Summary per category, then overall. */
export function summariseByCategory(results: CaseResult[]): [string, Summary][] {
  const categories = [...new Set(results.map((r) => r.category))];
  return [
    ...categories.map((c): [string, Summary] => [
      c,
      summarise(results.filter((r) => r.category === c)),
    ]),
    ['all', summarise(results)],
  ];
}
