import { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';
import { getOpenAIClient } from './openai-client';

export type ResponseMessageRole = 'system' | 'user' | 'assistant' | 'developer';

export interface ResponseMessage {
  role: ResponseMessageRole;
  content: string;
}

function supportsCustomTemperature(model: string): boolean {
  const normalized = model.toLowerCase();
  if (normalized.includes('reasoning')) {
    return false;
  }
  if (normalized.startsWith('gpt-5')) {
    return false;
  }
  if (normalized.startsWith('gpt-4.1')) {
    return false;
  }
  if (normalized.startsWith('o')) {
    return false;
  }
  return true;
}

type ResponseInputValue = Exclude<ResponseCreateParamsNonStreaming['input'], undefined>;

function buildResponseInput(messages: ResponseMessage[]): ResponseInputValue {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    type: 'message',
  }));
}

export interface CreateTextResponseOptions {
  model: string;
  messages: ResponseMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

export async function createTextResponse({
  model,
  messages,
  temperature,
  maxOutputTokens,
  frequencyPenalty,
  presencePenalty,
}: CreateTextResponseOptions): Promise<string> {
  const client = getOpenAIClient();
  const params: ResponseCreateParamsNonStreaming = {
    model,
    input: buildResponseInput(messages),
  };

  if (typeof maxOutputTokens === 'number') {
    params.max_output_tokens = maxOutputTokens;
  }

  if (typeof temperature === 'number' && supportsCustomTemperature(model)) {
    params.temperature = temperature;
  }

  if (typeof frequencyPenalty === 'number') {
    params.frequency_penalty = frequencyPenalty;
  }

  if (typeof presencePenalty === 'number') {
    params.presence_penalty = presencePenalty;
  }

  const response = await client.responses.create(params);
  return response.output_text.trim();
}
