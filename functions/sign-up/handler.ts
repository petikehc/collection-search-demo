import { Logger } from '@aws-lambda-powertools/logger';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { type PostConfirmationEvent, signUpNotification } from '../lib/auth/sign-up.js';

const logger = new Logger({ serviceName: 'sign-up' });
const sns = new SNSClient({});

/**
 * Cognito post-confirmation trigger: emails the site owner (through SNS) when someone signs up
 * and confirms their address. It never blocks a sign-up: Cognito fails the confirmation if a
 * trigger throws, so a failed notification is logged instead. The address isn't logged.
 */
export async function handler(event: PostConfirmationEvent) {
  const notification = signUpNotification(event, new Date());
  if (notification) {
    try {
      await sns.send(
        new PublishCommand({
          TopicArn: process.env.SIGN_UPS_TOPIC_ARN,
          Subject: notification.subject,
          Message: notification.message,
        }),
      );
      logger.info('sign-up notified');
    } catch (err) {
      logger.error('sign-up notification failed', err as Error);
    }
  }
  return event;
}
