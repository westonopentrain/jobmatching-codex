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
      task: { text: 'task capsule' },
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

  it('only upserts domain vector when user has no labeling experience', async () => {
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

    // Task vector should NOT be upserted (no labeling experience)
    expect(mockUpsertVector).not.toHaveBeenCalledWith(
      'usr_423423::task',
      expect.any(Array),
      expect.objectContaining({ section: 'task' })
    );

    // Response should indicate task was skipped
    const body = JSON.parse(response.body);
    expect(body.task.skipped).toBe(true);
    expect(body.task.vector_id).toBeNull();

    await app.close();
  });

  it('upserts both vectors when user has labeling experience', async () => {
    // Override mock to have labeling experience
    mockClassifyUser.mockResolvedValue({
      expertiseTier: 'entry',
      credentials: [],
      subjectMatterCodes: [],
      yearsExperience: 0,
      hasLabelingExperience: true,
      confidence: 0.8,
      reasoning: 'has labeling experience',
    });

    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/users/upsert',
      headers: { authorization: 'Bearer test-key' },
      payload: {
        user_id: '423423',
        resume_text: 'Sample resume with labeling experience',
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
        type: 'user',
      })
    );

    // Task vector should also be upserted
    expect(mockUpsertVector).toHaveBeenCalledWith(
      'usr_423423::task',
      expect.any(Array),
      expect.objectContaining({
        user_id: '423423',
        section: 'task',
        type: 'user',
      })
    );

    // Response should NOT have skipped flag
    const body = JSON.parse(response.body);
    expect(body.task.skipped).toBeUndefined();
    expect(body.task.vector_id).toBe('usr_423423::task');

    await app.close();
  });
});
