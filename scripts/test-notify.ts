/**
 * Test the /v1/jobs/notify endpoint
 *
 * Usage: npx tsx scripts/test-notify.ts [base_url]
 *
 * If no base_url provided, uses http://localhost:3000
 * For production: npx tsx scripts/test-notify.ts https://your-render-url
 */

import * as dotenv from 'dotenv';
dotenv.config();

const BASE_URL = process.argv[2] || 'http://localhost:3000';
const API_KEY = process.env.SERVICE_API_KEY;

if (!API_KEY) {
  console.error('ERROR: SERVICE_API_KEY environment variable not set');
  process.exit(1);
}

// Test job data - OBGYN job (specialized, should only match medical professionals)
const testJob = {
  job_id: 'test-notify-' + Date.now(),
  title: 'OBGYN Doctors - Test Notification',
  fields: {
    Instructions: 'OpenTrain AI is seeking experienced OBGYN doctors to help train an AI chatbot.',
    Requirements_Additional: 'MD degree with completed residency in Obstetrics and Gynecology. Minimum 5 years clinical experience.',
    Dataset_Description: 'Various topics in the OBGYN field',
    Data_SubjectMatter: 'OBGYN/Medical',
    LabelTypes: ['Evaluation/Rating', 'Prompt + Response Writing (SFT)'],
    AvailableLanguages: ['English'],
    AvailableCountries: ['USA', 'United Kingdom', 'India', 'Global - Any Location'],
  },
  available_countries: ['USA', 'United Kingdom', 'India', 'Global - Any Location'],
  available_languages: ['English'],
  max_notifications: 100,
};

async function testNotify() {
  console.log('=== Testing /v1/jobs/notify endpoint ===');
  console.log('Base URL:', BASE_URL);
  console.log('Job ID:', testJob.job_id);
  console.log('Title:', testJob.title);
  console.log('Countries:', testJob.available_countries);
  console.log('Languages:', testJob.available_languages);
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
      console.log('Threshold (Specialized):', data.score_stats.threshold_specialized);
      console.log('Threshold (Generic):', data.score_stats.threshold_generic);
    }

    console.log('');
    console.log('=== Users to Notify ===');
    if (data.notify_user_ids && data.notify_user_ids.length > 0) {
      data.notify_user_ids.forEach((userId: string, index: number) => {
        console.log(`${index + 1}. ${userId}`);
      });
    } else {
      console.log('No users to notify (either no matches or none above threshold)');
    }

    console.log('');
    console.log('=== Full Response ===');
    console.log(JSON.stringify(data, null, 2));

  } catch (error) {
    console.error('Request failed:', error);
    process.exit(1);
  }
}

testNotify();
