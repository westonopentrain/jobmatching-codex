import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { buildServer } from '../src/server';

import { generateCapsules } from '../src/services/capsules';
import { embedText } from '../src/services/embeddings';
import { upsertVector } from '../src/services/pinecone';
import { classifyUser } from '../src/services/user-classifier';

vi.mock('../src/services/capsules', () => ({
  generateCapsules: vi.fn(),
}));

vi.mock('../src/services/embeddings', () => ({
  embedText: vi.fn(),
  EMBEDDING_DIMENSION: 1536,
  EMBEDDING_MODEL: 'test-embedding-model',
}));

vi.mock('../src/services/pinecone', () => ({
  upsertVector: vi.fn(),
}));

vi.mock('../src/services/user-classifier', () => ({
  classifyUser: vi.fn(),
}));

const mockGenerateCapsules = generateCapsules as unknown as Mock;
const mockEmbedText = embedText as unknown as Mock;
const mockClassifyUser = classifyUser as unknown as Mock;
const mockUpsertVector = upsertVector as unknown as Mock;

describe('POST /v1/users/upsert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SERVICE_API_KEY = 'test-key';

    mockGenerateCapsules.mockResolvedValue({
      domain: { text: 'domain capsule' },
      task: { text: 'skills capsule' },
    });

    mockClassifyUser.mockResolvedValue({
      expertiseTier: 'entry',
      credentials: [],
      subjectMatterCodes: [],
      yearsExperience: 0,
      hasLabelingExperience: false,
      confidence: 0.5,
      reasoning: 'test classification',
    });

    const fakeVector = Array.from({ length: 1536 }, () => 0.1);
    mockEmbedText.mockResolvedValue(fakeVector);
  });

  it('always upserts both domain and skills vectors', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/users/upsert',
      headers: { authorization: 'Bearer test-key' },
      payload: {
        user_id: '423423',
        resume_text: 'Sample resume text',
      },
    });

    expect(response.statusCode).toBe(200);

    // Domain vector should be upserted
    expect(mockUpsertVector).toHaveBeenCalledWith(
      'usr_423423::domain',
      expect.any(Array),
      expect.objectContaining({
        user_id: '423423',
        section: 'domain',
        model: 'test-embedding-model',
        type: 'user',
      })
    );

    // Skills (task) vector should also be upserted - always, regardless of labeling experience
    expect(mockUpsertVector).toHaveBeenCalledWith(
      'usr_423423::task',
      expect.any(Array),
      expect.objectContaining({
        user_id: '423423',
        section: 'task',
        model: 'test-embedding-model',
        type: 'user',
      })
    );

    // Both vectors should be in the response
    const body = JSON.parse(response.body);
    expect(body.domain.vector_id).toBe('usr_423423::domain');
    expect(body.task.vector_id).toBe('usr_423423::task');
    expect(body.task.skipped).toBeUndefined();

    await app.close();
  });

  it('includes classification data in response', async () => {
    mockClassifyUser.mockResolvedValue({
      expertiseTier: 'specialist',
      credentials: ['MD'],
      subjectMatterCodes: ['medicine'],
      yearsExperience: 10,
      hasLabelingExperience: true,
      confidence: 0.9,
      reasoning: 'Medical professional',
    });

    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/users/upsert',
      headers: { authorization: 'Bearer test-key' },
      payload: {
        user_id: '423423',
        resume_text: 'Medical professional resume',
      },
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.classification.expertise_tier).toBe('specialist');
    expect(body.classification.credentials).toContain('MD');
    expect(body.classification.has_labeling_experience).toBe(true);

    await app.close();
  });
});
