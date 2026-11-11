import { describe, expect, it } from 'vitest';
import {
  type CaseResult,
  type EvalCase,
  expectationMet,
  parseJudge,
  recallAt,
  summarise,
} from '../lib/eval-score.js';

describe('recallAt', () => {
  it('counts expected objects found in the top k', () => {
    expect(recallAt(['a', 'b'], ['x', 'a', 'y'])).toBe(0.5);
    expect(recallAt(['a', 'b'], ['b', 'a'])).toBe(1);
  });

  it('ignores anything below the top k', () => {
    expect(recallAt(['a'], ['1', '2', '3', '4', '5', '6', 'a'])).toBe(0);
  });

  it('caps the denominator at k when more objects are expected than fit', () => {
    const expected = ['1', '2', '3', '4', '5', '6', '7', '8'];
    expect(recallAt(expected, ['1', '2', '3', '4', '5', '6'])).toBe(1);
  });
});

describe('expectationMet', () => {
  const base: EvalCase = { id: 'x', category: 'factual', question: 'q', expect: 'answer' };

  it('requires a block for blocked cases, and no block for answer cases', () => {
    expect(expectationMet({ ...base, expect: 'blocked' }, 'Sorry', true)).toBe(true);
    expect(expectationMet({ ...base, expect: 'blocked' }, 'Here you go', false)).toBe(false);
    expect(expectationMet(base, 'Sorry', true)).toBe(false);
  });

  it('fails an out-of-scope answer that uses facts from memory', () => {
    const paris = { ...base, expect: 'not-covered' as const, mustNotMention: ['Paris'] };
    expect(expectationMet(paris, "The collection records don't cover that.", false)).toBe(true);
    expect(expectationMet(paris, 'The capital of France is Paris.', false)).toBe(false);
  });

  it('accepts a guardrail block for an out-of-scope request', () => {
    expect(expectationMet({ ...base, expect: 'not-covered' }, 'Sorry', true)).toBe(true);
  });
});

describe('parseJudge', () => {
  it('extracts JSON even with text around it', () => {
    expect(parseJudge('Here: {"faithfulness": 5, "helpfulness": 4, "reason": "ok"} done')).toEqual({
      faithfulness: 5,
      helpfulness: 4,
      reason: 'ok',
    });
  });

  it('rejects scores outside 1-5 rather than averaging nonsense', () => {
    expect(() => parseJudge('{"faithfulness": 7, "helpfulness": 4}')).toThrow(/out of range/);
  });
});

describe('summarise', () => {
  const r = (over: Partial<CaseResult>): CaseResult => ({
    id: 'x',
    category: 'factual',
    expect: 'answer',
    question: 'q',
    answer: 'a',
    blocked: false,
    retrievedIds: [],
    citedIds: [],
    expectationMet: true,
    ms: 1,
    ...over,
  });

  it('averages recall only over cases that have expected objects', () => {
    const s = summarise([
      r({ recall: 1, hit: true, faithfulness: 5, helpfulness: 5 }),
      r({ recall: 0, hit: false, faithfulness: 3, helpfulness: 1 }),
      r({ category: 'blocked', expect: 'blocked', blocked: true }),
    ]);
    expect(s).toMatchObject({ cases: 3, meanRecall: 0.5, hitRate: 0.5, meanFaithfulness: 4 });
    expect(s.expectationRate).toBe(1);
  });
});
