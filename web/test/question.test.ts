import { describe, expect, it } from 'vitest';
import { looksLikeQuestion } from '../../functions/lib/search/question.js';
import { isNavigationOnThisSite } from '../src/lib/question.js';

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

describe('isNavigationOnThisSite', () => {
  const nav = (site: string, mode = 'navigate') =>
    new Headers({ 'sec-fetch-site': site, 'sec-fetch-mode': mode });

  it('is true for a page reached from one of our own pages, in any current browser', () => {
    // Safari sends no Sec-Fetch-User, so this mustn't depend on it.
    expect(isNavigationOnThisSite(nav('same-origin'))).toBe(true);
  });

  it('is false for tools, links from other sites, typed addresses and scripts', () => {
    expect(isNavigationOnThisSite(new Headers())).toBe(false);
    expect(isNavigationOnThisSite(nav('cross-site'))).toBe(false);
    expect(isNavigationOnThisSite(nav('none'))).toBe(false);
    expect(isNavigationOnThisSite(nav('same-origin', 'cors'))).toBe(false);
  });
});
