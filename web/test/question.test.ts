import { describe, expect, it } from 'vitest';
import { isPersonsAction, looksLikeQuestion } from '../src/lib/question.js';

describe('looksLikeQuestion', () => {
  it.each([
    'What did people use to start fires?',
    'how did people travel before cars',
    'Tell me about convict love tokens',
    'woomera?',
    'objects made by convicts in Tasmania before 1850',
  ])('treats %j as a question', (q) => {
    expect(looksLikeQuestion(q)).toBe(true);
  });

  it.each(['woomera', 'convict love token', 'Photographs 1910', '', '  ', 'wh'])(
    'treats %j as keywords',
    (q) => {
      expect(looksLikeQuestion(q)).toBe(false);
    },
  );

  it('needs a whole question word, not a prefix', () => {
    expect(looksLikeQuestion('whatnot')).toBe(false);
    expect(looksLikeQuestion('Howitt collection')).toBe(false);
  });
});

describe('isPersonsAction', () => {
  it('is true only for navigations a user triggered', () => {
    expect(isPersonsAction(new Headers({ 'sec-fetch-user': '?1' }))).toBe(true);
    expect(isPersonsAction(new Headers())).toBe(false);
    expect(isPersonsAction(new Headers({ 'sec-fetch-user': '?0' }))).toBe(false);
  });
});
