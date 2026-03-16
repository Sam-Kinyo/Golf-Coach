import { Client, WebhookEvent } from '@line/bot-sdk';
import { env } from '../config/env';

const client = new Client({
  channelAccessToken: env.line.channelAccessToken,
});

export function getLineClient(): Client {
  return client;
}

export function parseWebhook(body: string, signature: string): WebhookEvent {
  const crypto = require('crypto');
  const hash = crypto.createHmac('sha256', env.line.channelSecret).update(body).digest('base64');
  if (hash !== signature) {
    throw new Error('Invalid signature');
  }
  return JSON.parse(body) as WebhookEvent;
}

export async function pushMessage(to: string, messages: object[]): Promise<void> {
  await client.pushMessage(to, messages as any);
}

export async function replyMessage(replyToken: string, text: string): Promise<void> {
  await client.replyMessage(replyToken, { type: 'text', text });
}

export async function replyFlex(replyToken: string, altText: string, contents: object): Promise<void> {
  await client.replyMessage(replyToken, { type: 'flex', altText, contents } as any);
}

export async function replyButtons(
  replyToken: string,
  text: string,
  buttonLabel: string,
  uri: string
): Promise<void> {
  await client.replyMessage(replyToken, {
    type: 'template',
    altText: text,
    template: {
      type: 'buttons',
      text,
      actions: [{ type: 'uri', label: buttonLabel, uri }],
    },
  } as any);
}

export function isCoach(userId: string): boolean {
  return env.coachLineUserIds.includes(userId);
}
