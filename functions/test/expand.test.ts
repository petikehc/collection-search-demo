import { describe, expect, it } from 'vitest';
import { expandQuestion, SYNONYM_RULES } from '../lib/ask/expand.js';

describe('expandQuestion', () => {
  it('reads the same synonym rules as the keyword analyser', () => {
    expect(SYNONYM_RULES).toContainEqual(['spear thrower', 'spearthrower', 'woomera']);
  });

  it('adds the other names for a term the question mentions', () => {
    expect(expandQuestion('What is a woomera?')).toBe(
      'What is a woomera? [search terms: spear thrower, spearthrower]',
    );
  });

  it('matches plurals and multi-word terms, case-insensitively', () => {
    expect(expandQuestion('Show me Woomeras')).toContain('spearthrower');
    expect(expandQuestion('What is a spear thrower?')).toContain('woomera');
  });

  it('leaves questions without synonym terms unchanged', () => {
    expect(expandQuestion('What did people use to start fires?')).toBe(
      'What did people use to start fires?',
    );
  });

  it('matches whole words only, so a substring does not trigger it', () => {
    // "ute" is a synonym term; "computer" and "route" must not expand.
    expect(expandQuestion('Is there a computer route map?')).toBe('Is there a computer route map?');
  });
});
