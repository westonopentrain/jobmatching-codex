/**
 * Bubble Data API client
 *
 * Fetches data directly from Bubble's database to sync state with Render.
 */

import { logger } from '../utils/logger';
import { getEnv } from '../utils/env';

// Production Bubble Data API (not the versioned dev URL)
const BUBBLE_API_URL = getEnv('BUBBLE_API_URL') || 'https://app.opentrain.ai/api/1.1/obj';
const BUBBLE_API_KEY = getEnv('BUBBLE_API_KEY') || '';

interface BubbleJob {
  _id: string;
  Title?: string;
  Status?: string;
  ExampleJob?: boolean | null;
  'AcceptingApplicants?'?: boolean;
  'Published (yes/no)'?: boolean;
}

interface BubbleResponse<T> {
  response: {
    results: T[];
    remaining: number;
    count: number;
  };
}

/**
 * Fetch active jobs from Bubble
 * Active = Published=true, AcceptingApplicants=true, ExampleJob!=true, Status != Archived
 */
export async function fetchActiveJobsFromBubble(): Promise<string[]> {
  if (!BUBBLE_API_KEY) {
    logger.warn({ event: 'bubble.api.no_key' }, 'BUBBLE_API_KEY not configured, skipping Bubble sync');
    return [];
  }

  const allJobIds: string[] = [];
  let cursor = 0;
  const limit = 100;

  try {
    // Bubble Data API constraints
    // Note: boolean values are passed as strings "true"/"false"
    const constraints = [
      { key: 'Published (yes/no)', constraint_type: 'equals', value: 'true' },
      { key: 'AcceptingApplicants?', constraint_type: 'equals', value: 'true' },
    ];

    const constraintsParam = encodeURIComponent(JSON.stringify(constraints));

    while (true) {
      const url = `${BUBBLE_API_URL}/Job?constraints=${constraintsParam}&limit=${limit}&cursor=${cursor}`;

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${BUBBLE_API_KEY}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Bubble API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as BubbleResponse<BubbleJob>;
      const jobs = data.response.results;

      // Filter out archived jobs and example jobs
      for (const job of jobs) {
        if (job.Status !== 'Archived' && job.ExampleJob !== true) {
          allJobIds.push(job._id);
        }
      }

      logger.info(
        {
          event: 'bubble.fetch.page',
          cursor,
          fetched: jobs.length,
          remaining: data.response.remaining,
          totalSoFar: allJobIds.length,
        },
        'Fetched page of jobs from Bubble'
      );

      if (data.response.remaining === 0) {
        break;
      }

      cursor += limit;
    }

    logger.info(
      { event: 'bubble.fetch.complete', totalActiveJobs: allJobIds.length },
      'Completed fetching active jobs from Bubble'
    );

    return allJobIds;
  } catch (error) {
    logger.error(
      { event: 'bubble.fetch.error', error },
      'Failed to fetch active jobs from Bubble'
    );
    throw error;
  }
}
