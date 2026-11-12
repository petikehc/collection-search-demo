import {
  ConditionalCheckFailedException,
  type DynamoDBClient,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';

/** A daily allowance of answers, shared by everyone: Ask needs no sign-in, so nothing else bounds its cost. */
export interface AskBudget {
  /** Takes one answer from today's allowance. False when none are left. */
  take(): Promise<boolean>;
}

/** The UTC day, e.g. 2026-11-12: the counter's key, so a new day starts a new count. */
export const dayKey = (now: Date) => now.toISOString().slice(0, 10);

/**
 * One DynamoDB item per day. The increment and the limit check are a single conditional write,
 * so concurrent requests can't both take the last answer. Old days expire by TTL.
 */
export function dynamoAskBudget(
  client: DynamoDBClient,
  tableName: string,
  dailyCap: number,
  now: () => Date = () => new Date(),
): AskBudget {
  return {
    async take() {
      const today = now();
      try {
        await client.send(
          new UpdateItemCommand({
            TableName: tableName,
            Key: { day: { S: dayKey(today) } },
            UpdateExpression: 'ADD #count :one SET #ttl = if_not_exists(#ttl, :expires)',
            ConditionExpression: 'attribute_not_exists(#count) OR #count < :cap',
            ExpressionAttributeNames: { '#count': 'count', '#ttl': 'expiresAt' },
            ExpressionAttributeValues: {
              ':one': { N: '1' },
              ':cap': { N: String(dailyCap) },
              // A week is plenty to look back at usage; DynamoDB deletes the item after that.
              ':expires': { N: String(Math.floor(today.getTime() / 1000) + 7 * 24 * 3600) },
            },
          }),
        );
        return true;
      } catch (err) {
        if (err instanceof ConditionalCheckFailedException) return false;
        throw err;
      }
    },
  };
}
