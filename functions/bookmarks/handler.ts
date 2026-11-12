import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { type Bookmark, type BookmarksStore, handleBookmarks } from '../lib/bookmarks/bookmarks.js';

const logger = new Logger();
const tracer = new Tracer();

const db = DynamoDBDocumentClient.from(tracer.captureAWSv3Client(new DynamoDBClient({})));
const TableName = process.env.TABLE_NAME ?? '';

/**
 * Keys: `sub` (partition) and `objectId` (sort). One Query reads a user's whole list (a page is
 * up to 1 MB, thousands of bookmarks; more than that would need paging).
 */
const dynamoStore: BookmarksStore = {
  async list(sub) {
    const { Items = [] } = await db.send(
      new QueryCommand({
        TableName,
        KeyConditionExpression: '#sub = :sub',
        ExpressionAttributeNames: { '#sub': 'sub' },
        ExpressionAttributeValues: { ':sub': sub },
      }),
    );
    return Items.map(({ objectId, title, addedAt }) => ({ objectId, title, addedAt }) as Bookmark);
  },
  async put(sub, bookmark) {
    await db.send(new PutCommand({ TableName, Item: { sub, ...bookmark } }));
  },
  async remove(sub, objectId) {
    await db.send(new DeleteCommand({ TableName, Key: { sub, objectId } }));
  },
};

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  logger.appendKeys({ requestId: event.requestContext?.requestId });
  try {
    const res = await handleBookmarks(event, dynamoStore);
    // The user's sub is a pseudonymous ID; no email or title is logged.
    logger.info('bookmarks', {
      route: `${event.httpMethod} ${event.resource}`,
      status: res.statusCode,
    });
    return res;
  } catch (err) {
    logger.error('bookmarks failed', err as Error);
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Bookmarks are temporarily unavailable' }),
    };
  } finally {
    logger.resetKeys();
  }
}
