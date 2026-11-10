import { readFileSync } from 'node:fs';
import { App, Stack } from 'aws-cdk-lib';
import { describe, expect, it } from 'vitest';
import { buildApp, PROJECT_TAGS } from '../lib/app.js';

// Use the same feature flags as `cdk synth`, so tests can't pass on different behaviour.
const { context } = JSON.parse(readFileSync(new URL('../cdk.json', import.meta.url), 'utf8'));

describe('CDK app', () => {
  it('tags every stack with the project tags', () => {
    const stacks = buildApp(new App({ context })).node.children.filter(Stack.isStack);

    expect(stacks.length).toBeGreaterThan(0);
    for (const stack of stacks) {
      expect(stack.tags.tagValues()).toMatchObject(PROJECT_TAGS);
    }
  });
});
