import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { buildServer } from '../src/server';
import { EMBEDDING_DIMENSION } from '../src/services/embeddings';
import { fetchVectors, queryByVector } from '../src/services/pinecone';

vi.mock('../src/services/pinecone', () => ({
  fetchVectors: vi.fn(),
  queryByVector: vi.fn(),
}));

const mockFetchVectors = fetchVectors as unknown as Mock;
const mockQueryByVector = queryByVector as unknown as Mock;

function makeVector(value: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSION }, () => value);
}

describe('POST /v1/match/score_users_for_job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SERVICE_API_KEY = 'test-key';
  });

  it('normalizes weights and returns blended results with missing vectors tracked', async () => {
    const domainVector = makeVector(0.1);
    const taskVector = makeVector(0.2);
    mockFetchVectors.mockResolvedValue({
      'job_job123::domain': { id: 'job_job123::domain', values: domainVector },
      'job_job123::task': { id: 'job_job123::task', values: taskVector },
    });

    mockQueryByVector.mockImplementation(({ filter }: { filter: { section: string } }) => {
      if (filter.section === 'domain') {
        return Promise.resolve([
          { id: 'usr_u_101::domain', score: 0.913274, metadata: { user_id: 'u_101' } },
          { id: 'usr_u_104::domain', score: 0.887113, metadata: { user_id: 'u_104' } },
          { id: 'usr_u_102::domain', score: 0.721004, metadata: { user_id: 'u_102' } },
          { id: 'usr_u_103::domain', score: 0.512901, metadata: { user_id: 'u_103' } },
        ]);
      }
      return Promise.resolve([
        { id: 'usr_u_101::task', score: 0.062134, metadata: { user_id: 'u_101' } },
      ]);
    });

    const app = buildServer();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/match/score_users_for_job',
      headers: { authorization: 'Bearer test-key' },
      payload: {
        job_id: 'job123',
        candidate_user_ids: ['u_101', 'u_102', 'u_103', 'u_104'],
        w_domain: 2.0,
        w_task: 0.0,
        threshold: 0.82,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.w_domain).toBe(1);
    expect(body.w_task).toBe(0);
    expect(body.results).toHaveLength(4);
    expect(body.results[0]).toMatchObject({
      user_id: 'u_101',
      s_domain: 0.913274,
      s_task: 0.062134,
      final: 0.913274,
      rank: 1,
    });
    expect(body.results.map((item: { user_id: string }) => item.user_id)).toEqual([
      'u_101',
      'u_104',
      'u_102',
      'u_103',
    ]);
    expect(body.results.map((item: { s_task: number | null }) => item.s_task)).toEqual([
      0.062134,
      null,
      null,
      null,
    ]);
    expect(body.missing_vectors).toEqual({ domain: [], task: ['u_102', 'u_103', 'u_104'] });
    expect(body.threshold_used).toBe(0.82);
    expect(body.count_gte_threshold).toBe(2);
    expect(typeof body.elapsed_ms).toBe('number');

    await app.close();
  });

  it('blends normalized weights from both channels', async () => {
    const domainVector = makeVector(0.2);
    const taskVector = makeVector(0.4);
    mockFetchVectors.mockResolvedValue({
      'job_job42::domain': { id: 'job_job42::domain', values: domainVector },
      'job_job42::task': { id: 'job_job42::task', values: taskVector },
    });

    mockQueryByVector.mockImplementation(({ filter }: { filter: { section: string } }) => {
      if (filter.section === 'domain') {
        return Promise.resolve([
          { id: 'usr_alpha::domain', score: 0.8, metadata: { user_id: 'alpha' } },
        ]);
      }
      return Promise.resolve([
        { id: 'usr_alpha::task', score: 0.6, metadata: { user_id: 'alpha' } },
      ]);
    });

    const app = buildServer();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/match/score_users_for_job',
      headers: { authorization: 'Bearer test-key' },
      payload: {
        job_id: 'job42',
        candidate_user_ids: ['alpha'],
        w_domain: 0.3,
        w_task: 0.3,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.w_domain).toBeCloseTo(0.5, 6);
    expect(body.w_task).toBeCloseTo(0.5, 6);
    expect(body.results[0]).toMatchObject({
      user_id: 'alpha',
      s_domain: 0.8,
      s_task: 0.6,
      final: 0.7,
      rank: 1,
    });

    await app.close();
  });

  it('chunks candidate lists to stay within Pinecone $in limits', async () => {
    const domainVector = makeVector(0.5);
    const taskVector = makeVector(0.5);
    mockFetchVectors.mockResolvedValue({
      'job_jobChunk::domain': { id: 'job_jobChunk::domain', values: domainVector },
      'job_jobChunk::task': { id: 'job_jobChunk::task', values: taskVector },
    });

    mockQueryByVector.mockResolvedValue([]);

    const candidates = Array.from({ length: 1200 }, (_, index) => `u_${String(index + 1).padStart(4, '0')}`);

    const app = buildServer();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/match/score_users_for_job',
      headers: { authorization: 'Bearer test-key' },
      payload: {
        job_id: 'jobChunk',
        candidate_user_ids: candidates,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.results).toHaveLength(1200);
    expect(body.missing_vectors.domain).toHaveLength(1200);
    expect(body.missing_vectors.task).toHaveLength(1200);
    expect(body.results.map((item: { user_id: string }) => item.user_id)).toEqual([...candidates].sort());
    expect(mockQueryByVector).toHaveBeenCalledTimes(6);

    await app.close();
  });

  it('rejects non-finite weights', async () => {
    const app = buildServer();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/match/score_users_for_job',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      payload: '{"job_id":"jobBad","candidate_user_ids":["u_1"],"w_domain":1e309,"w_task":0}',
    });

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('UNPROCESSABLE_WEIGHTS');
    expect(body.request_id).toBeDefined();
    expect(mockFetchVectors).not.toHaveBeenCalled();

    await app.close();
  });

  it('returns 404 when job vectors are missing', async () => {
    mockFetchVectors.mockResolvedValue({});

    const app = buildServer();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/match/score_users_for_job',
      headers: { authorization: 'Bearer test-key' },
      payload: {
        job_id: 'job-missing',
        candidate_user_ids: ['u_1', 'u_2'],
      },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('JOB_VECTORS_MISSING');
    expect(mockQueryByVector).not.toHaveBeenCalled();

    await app.close();
  });
});
