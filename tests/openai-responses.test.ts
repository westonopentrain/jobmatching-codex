import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTextResponse } from '../src/services/openai-responses';

const mockCreate = vi.fn();

vi.mock('../src/services/openai-client', () => ({
  getOpenAIClient: () => ({
    responses: {
      create: mockCreate,
    },
  }),
}));

describe('createTextResponse parameter handling', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('applies caller-provided tuning for unconstrained models', async () => {
    mockCreate.mockResolvedValue({
      output_text: 'hello world',
    });

    const result = await createTextResponse({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a test harness.' },
        { role: 'user', content: 'Say hello.' },
      ],
      temperature: 0.2,
      maxOutputTokens: 512,
    });

    expect(result).toBe('hello world');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const payload = mockCreate.mock.calls[0][0];
    expect(payload.temperature).toBe(0.2);
    expect(payload.max_output_tokens).toBe(512);
  });

  it('omits tuning parameters for constrained reasoning-style models', async () => {
    mockCreate.mockResolvedValue({
      output_text: 'constraints respected',
    });

    await createTextResponse({
      model: 'o1-mini',
      messages: [
        { role: 'system', content: 'You are a test harness.' },
        { role: 'user', content: 'Say hello.' },
      ],
      temperature: 0.7,
      maxOutputTokens: 2048,
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const payload = mockCreate.mock.calls[0][0];
    expect(payload.temperature).toBeUndefined();
    expect(payload.max_output_tokens).toBeUndefined();
  });
});
