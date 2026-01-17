/**
 * Test the /v1/jobs/notify endpoint without strict filters
 * This should return all users in Pinecone that match the job
 */

import * as dotenv from 'dotenv';
dotenv.config();

const BASE_URL = process.argv[2] || 'http://localhost:8080';
const API_KEY = process.env.SERVICE_API_KEY;

if (!API_KEY) {
  console.error('ERROR: SERVICE_API_KEY environment variable not set');
  process.exit(1);
}

// Test job with minimal filters - should match more users
const testJob = {
  job_id: 'test-notify-global-' + Date.now(),
  title: 'OBGYN Doctors - Global Test',
  fields: {
    Instructions: 'OpenTrain AI is seeking experienced OBGYN doctors.',
    Requirements_Additional: 'MD degree with completed residency in OBGYN.',
    Data_SubjectMatter: 'OBGYN/Medical',
  },
  // Global = all countries, no language filter
  available_countries: ['Global - Any Location'],
  // No language filter = all languages
  available_languages: [],
  max_notifications: 100,
};

async function testNotify() {
  console.log('=== Testing /v1/jobs/notify (Global, No Language Filter) ===');
  console.log('Base URL:', BASE_URL);
  console.log('Job ID:', testJob.job_id);
  console.log('Countries:', testJob.available_countries);
  console.log('Languages:', testJob.available_languages || '(none - all languages)');
  console.log('');

  try {
    const response = await fetch(`${BASE_URL}/v1/jobs/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(testJob),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('ERROR:', response.status, response.statusText);
      console.error(JSON.stringify(data, null, 2));
      process.exit(1);
    }

    console.log('=== Response ===');
    console.log('Status:', data.status);
    console.log('Job Class:', data.job_class);
    console.log('Total Candidates:', data.total_candidates);
    console.log('Total Above Threshold:', data.total_above_threshold);
    console.log('Notify User IDs:', data.notify_user_ids?.length || 0);
    console.log('Elapsed (ms):', data.elapsed_ms);
    console.log('');

    if (data.score_stats) {
      console.log('=== Score Stats ===');
      console.log('Min Score:', data.score_stats.min);
      console.log('Max Score:', data.score_stats.max);
    }

    console.log('');
    console.log('=== Users to Notify ===');
    if (data.notify_user_ids && data.notify_user_ids.length > 0) {
      data.notify_user_ids.forEach((userId: string, index: number) => {
        console.log(`${index + 1}. ${userId}`);
      });
    } else {
      console.log('No users to notify');
    }

  } catch (error) {
    console.error('Request failed:', error);
    process.exit(1);
  }
}

testNotify();
