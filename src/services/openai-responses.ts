import {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseOutputItem,
} from 'openai/resources/responses/responses';
import { getOpenAIClient } from './openai-client';

export type ResponseMessageRole = 'system' | 'user' | 'assistant' | 'developer';

export interface ResponseMessage {
  role: ResponseMessageRole;
  content: string;
}

function isConstrainedModel(model: string): boolean {
  const normalized = model.toLowerCase();
  if (normalized.includes('reasoning')) {
    return true;
  }
  if (normalized.startsWith('gpt-5')) {
    return true;
  }
  if (normalized.startsWith('gpt-4.1')) {
    return true;
  }
  if (normalized.startsWith('o')) {
    return true;
  }
  return false;
}

function supportsCustomTemperature(model: string): boolean {
  return !isConstrainedModel(model);
}

function supportsCustomMaxOutputTokens(model: string): boolean {
  return !isConstrainedModel(model);
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
}

export async function createTextResponse({
  model,
  messages,
  temperature,
  maxOutputTokens,
}: CreateTextResponseOptions): Promise<string> {
  const client = getOpenAIClient();
  const params: ResponseCreateParamsNonStreaming = {
    model,
    input: buildResponseInput(messages),
  };

  if (typeof maxOutputTokens === 'number' && supportsCustomMaxOutputTokens(model)) {
    params.max_output_tokens = maxOutputTokens;
  }

  if (typeof temperature === 'number' && supportsCustomTemperature(model)) {
    params.temperature = temperature;
  }

  const response = await client.responses.create(params);
  const text = extractResponseText(response);
  if (text.length > 0) {
    return text;
  }

  if (response.error?.message) {
    const error = new Error(response.error.message);
    (error as { code?: string }).code = response.error.code;
    throw error;
  }

  const refusal = extractRefusalReason(response);
  if (refusal) {
    throw new Error(refusal);
  }

  const incompleteReason = response.incomplete_details?.reason;
  if (incompleteReason) {
    throw new Error(`OpenAI marked response incomplete: ${incompleteReason}`);
  }

  throw new Error('OpenAI response did not include any text output');
}

function extractResponseText(response: Response): string {
  const primary = typeof response.output_text === 'string' ? response.output_text.trim() : '';
  if (primary.length > 0) {
    return primary;
  }

  const segments: string[] = [];

  for (const item of response.output ?? []) {
    collectOutputText(item, segments);
  }

  return segments.join('').trim();
}

function collectOutputText(item: ResponseOutputItem, segments: string[]): void {
  if (!item || typeof item !== 'object') {
    return;
  }

  const type = (item as { type?: unknown }).type;
  if (type === 'output_text') {
    const text = (item as { text?: unknown }).text;
    if (typeof text === 'string') {
      segments.push(text);
    }
    return;
  }

  const content = (item as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return;
  }

  for (const part of content) {
    if (!part || typeof part !== 'object') {
      continue;
    }
    const partType = (part as { type?: unknown }).type;
    if (partType === 'output_text') {
      const text = (part as { text?: unknown }).text;
      if (typeof text === 'string') {
        segments.push(text);
      }
    }
  }
}

function extractRefusalReason(response: Response): string | undefined {
  for (const item of response.output ?? []) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      if (!part || typeof part !== 'object') {
        continue;
      }
      const type = (part as { type?: unknown }).type;
      if (type === 'refusal') {
        const refusal = (part as { refusal?: unknown }).refusal;
        if (typeof refusal === 'string' && refusal.trim().length > 0) {
          return refusal.trim();
        }
      }
    }
  }

  return undefined;
}
