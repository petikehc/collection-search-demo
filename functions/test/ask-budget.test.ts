import { ConditionalCheckFailedException, type DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { describe, expect, it } from 'vitest';
import { dayKey, dynamoAskBudget } from '../lib/ask/budget.js';

type Input = {
  Key: { day: { S: string } };
  ConditionExpression: string;
  ExpressionAttributeValues: Record<string, { N: string }>;
};

/**
 * Behaves like DynamoDB for this one conditional update: the condition and the increment are
 * one atomic step per item, so the count can't pass the cap however calls interleave.
 */
function fakeDynamo() {
  const counts = new Map<string, number>();
  const inputs: Input[] = [];
  const client = {
    send: async (command: { input: Input }) => {
      const input = command.input;
      inputs.push(input);
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 3));
      const day = input.Key.day.S;
      const cap = Number(input.ExpressionAttributeValues[':cap']?.N);
      const count = counts.get(day);
      if (count !== undefined && count >= cap) {
        throw new ConditionalCheckFailedException({ message: 'cap', $metadata: {} });
      }
      counts.set(day, (count ?? 0) + 1);
      return {};
    },
  } as unknown as DynamoDBClient;
  return { client, counts, inputs };
}

describe('dynamoAskBudget', () => {
  const noon = new Date('2026-11-12T12:00:00Z');

  it('allows answers up to the cap, then refuses', async () => {
    const { client } = fakeDynamo();
    const budget = dynamoAskBudget(client, 'budget', 3, () => noon);
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await budget.take());
    expect(results).toEqual([true, true, true, false, false]);
  });

  it('never goes over the cap when requests arrive together', async () => {
    const { client, counts } = fakeDynamo();
    const budget = dynamoAskBudget(client, 'budget', 10, () => noon);
    const results = await Promise.all(Array.from({ length: 40 }, () => budget.take()));
    expect(results.filter(Boolean)).toHaveLength(10);
    expect(counts.get('2026-11-12')).toBe(10);
  });

  it('starts a new count each UTC day', async () => {
    const { client } = fakeDynamo();
    let now = noon;
    const budget = dynamoAskBudget(client, 'budget', 1, () => now);
    expect(await budget.take()).toBe(true);
    expect(await budget.take()).toBe(false);
    now = new Date('2026-11-13T00:00:01Z');
    expect(await budget.take()).toBe(true);
  });

  it('checks and counts in one conditional write, and expires the item after a week', async () => {
    const { client, inputs } = fakeDynamo();
    await dynamoAskBudget(client, 'budget', 500, () => noon).take();
    expect(inputs[0]).toMatchObject({
      Key: { day: { S: '2026-11-12' } },
      ConditionExpression: 'attribute_not_exists(#count) OR #count < :cap',
      ExpressionAttributeValues: {
        ':cap': { N: '500' },
        ':expires': { N: String(noon.getTime() / 1000 + 7 * 24 * 3600) },
      },
    });
  });

  it('fails loudly on any other DynamoDB error, rather than letting the request through', async () => {
    const client = {
      send: async () => {
        throw new Error('throttled');
      },
    } as unknown as DynamoDBClient;
    await expect(dynamoAskBudget(client, 'budget', 1).take()).rejects.toThrow('throttled');
  });
});

describe('dayKey', () => {
  it('is the UTC date', () => {
    expect(dayKey(new Date('2026-11-12T23:59:59+11:00'))).toBe('2026-11-12');
  });
});
