const BUBBLE_API = 'https://app.opentrain.ai/version-02wlo/api/1.1/obj';
const API_KEY = 'ac589face4818ffaeec13163c764dbc7';

interface BubbleJob {
  _id: string;
  Title?: string;
  Data_SubjectMatter?: string;
  ExpertiseLevel?: string;
  Requirements_Additional?: string;
}

interface BubbleJobOffer {
  Job?: string;
  Offer_Status?: string;
}

async function fetchJobs(): Promise<BubbleJob[]> {
  const response = await fetch(`${BUBBLE_API}/Job?limit=50&sort_field=Modified%20Date&descending=true`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  const data = await response.json() as { response: { results: BubbleJob[] } };
  return data.response.results;
}

async function countOffersForJob(jobId: string): Promise<{ total: number; hired: number }> {
  const constraint = encodeURIComponent(JSON.stringify([{ key: 'Job', constraint_type: 'equals', value: jobId }]));
  const response = await fetch(`${BUBBLE_API}/jobOffer?constraints=${constraint}&limit=200`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  const data = await response.json() as { response: { results: BubbleJobOffer[] } };
  const offers = data.response.results;
  return {
    total: offers.length,
    hired: offers.filter(o => o.Offer_Status === 'Hired').length
  };
}

async function main() {
  const jobs = await fetchJobs();
  const realJobs = jobs.filter(j =>
    j.Title &&
    !j.Title.toLowerCase().includes('test') &&
    !j.Title.toLowerCase().includes('sample') &&
    j.Title.length > 10
  );

  console.log('Jobs with proposals:\n');

  for (const job of realJobs.slice(0, 15)) {
    const counts = await countOffersForJob(job._id);
    if (counts.total >= 5) {
      console.log(job.Title);
      console.log('  ID: ' + job._id);
      console.log('  Subject: ' + (job.Data_SubjectMatter || 'N/A'));
      console.log('  Level: ' + (job.ExpertiseLevel || 'N/A'));
      console.log('  Proposals: ' + counts.total + ' (' + counts.hired + ' hired)');
      console.log();
    }
  }
}

main().catch(console.error);
