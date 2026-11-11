import { readFileSync } from 'node:fs';
import { App, Stack } from 'aws-cdk-lib';
import { describe, expect, it } from 'vitest';
import { buildApp, PROJECT_TAGS } from '../lib/app.js';

// Use the same feature flags as `cdk synth`, so tests can't pass on different behaviour.
const { context: flags } = JSON.parse(
  readFileSync(new URL('../cdk.json', import.meta.url), 'utf8'),
);
// No asset bundling: these tests don't need the Lambda or Astro builds (`pnpm synth` runs them).
const context = { ...flags, 'aws:cdk:bundling-stacks': [] };

describe('CDK app', () => {
  it('tags every stack with the project tags', () => {
    const stacks = buildApp(new App({ context })).node.children.filter(Stack.isStack);

    expect(stacks.length).toBeGreaterThan(0);
    for (const stack of stacks) {
      expect(stack.tags.tagValues()).toMatchObject(PROJECT_TAGS);
    }
  });
});

describe('log group defaults', () => {
  it('caps retention at 14 days and deletes every log group with its stack', () => {
    const assembly = buildApp(new App({ context })).synth();
    for (const stack of assembly.stacks) {
      const resources = Object.values(stack.template.Resources ?? {}) as {
        Type: string;
        DeletionPolicy?: string;
        Properties?: { RetentionInDays?: number };
      }[];
      for (const r of resources.filter((r) => r.Type === 'AWS::Logs::LogGroup')) {
        expect(r.Properties?.RetentionInDays).toBeLessThanOrEqual(14);
        expect(r.DeletionPolicy).toBe('Delete');
      }
    }
  });
});
