/**
 * Slack webhook integration for sending alerts
 */

import { logger } from '../utils/logger';
import { getEnv } from '../utils/env';

let webhookUrl: string | null = null;
let initialized = false;

function getWebhookUrl(): string | null {
  if (!initialized) {
    webhookUrl = getEnv('SLACK_WEBHOOK_URL') || null;
    initialized = true;

    if (!webhookUrl) {
      logger.info({ event: 'slack.skip' }, 'SLACK_WEBHOOK_URL not configured, alerts disabled');
    } else {
      logger.info({ event: 'slack.init' }, 'Slack webhook configured');
    }
  }
  return webhookUrl;
}

export function isSlackConfigured(): boolean {
  return getWebhookUrl() !== null;
}

export interface SlackMessage {
  text: string;
  blocks?: SlackBlock[];
}

export interface SlackBlock {
  type: 'section' | 'divider' | 'header' | 'context';
  text?: {
    type: 'mrkdwn' | 'plain_text';
    text: string;
  };
  fields?: Array<{
    type: 'mrkdwn' | 'plain_text';
    text: string;
  }>;
  elements?: Array<{
    type: 'mrkdwn' | 'plain_text';
    text: string;
  }>;
}

/**
 * Send a message to Slack (non-blocking)
 */
export function sendSlackMessage(message: SlackMessage): void {
  const url = getWebhookUrl();
  if (!url) {
    return;
  }

  // Fire and forget
  (async () => {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        const text = await response.text();
        logger.error(
          { event: 'slack.error', status: response.status, body: text },
          'Failed to send Slack message'
        );
      } else {
        logger.debug({ event: 'slack.sent' }, 'Slack message sent');
      }
    } catch (error) {
      logger.error({ event: 'slack.error', error }, 'Failed to send Slack message');
    }
  })();
}

/**
 * Send a simple text alert to Slack
 */
export function sendSlackAlert(title: string, message: string, fields?: Record<string, string>): void {
  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: title,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: message,
      },
    },
  ];

  if (fields && Object.keys(fields).length > 0) {
    blocks.push({
      type: 'section',
      fields: Object.entries(fields).map(([key, value]) => ({
        type: 'mrkdwn' as const,
        text: `*${key}:*\n${value}`,
      })),
    });
  }

  sendSlackMessage({
    text: `${title}: ${message}`,
    blocks,
  });
}
