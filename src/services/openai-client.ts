import OpenAI from 'openai';
import { requireEnv } from '../utils/env';

let client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!client) {
    const apiKey = requireEnv('OPENAI_API_KEY');
    client = new OpenAI({ apiKey });
  }
  return client;
}
