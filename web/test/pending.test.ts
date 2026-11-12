import { describe, expect, it } from 'vitest';
import { parsePendingBookmark } from '../src/lib/pending.js';

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe('parsePendingBookmark', () => {
  it('keeps an add, with a valid object ID and title', () => {
    expect(
      parsePendingBookmark(form({ action: 'add', objectId: '17418', title: ' Spearthrower ' })),
    ).toEqual({
      objectId: '17418',
      title: 'Spearthrower',
    });
  });

  it.each([
    { action: 'remove', objectId: '17418', title: 'Spearthrower' },
    { action: 'add', objectId: '17418abc', title: 'Spearthrower' },
    { action: 'add', objectId: '../admin', title: 'x' },
    { action: 'add', objectId: '17418', title: '' },
    { action: 'add', objectId: '17418', title: 'x'.repeat(301) },
  ])('ignores %j', (fields) => {
    expect(parsePendingBookmark(form(fields))).toBeUndefined();
  });
});
