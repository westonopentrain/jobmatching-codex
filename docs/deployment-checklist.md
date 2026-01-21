# Deployment Checklist: Job Matching System Go-Live

## Overview

This checklist tracks everything needed before deploying the job matching system to production.

---

## 1. Development Data Cleanup

**Decision:** Fresh start - clear all development data.

### Actions:
- [ ] Delete all vectors from Pinecone index via console
- [ ] Truncate PostgreSQL tables via Render shell:
  ```sql
  TRUNCATE audit_user_upsert, audit_job_upsert, audit_user_metadata_update,
           audit_job_metadata_update, audit_job_notify, audit_job_notify_result,
           audit_re_notify, audit_recommended_jobs, audit_user_match_request,
           audit_match_request, job_user_qualification, jobs CASCADE;
  ```
- [ ] Verify tables are empty via Admin Dashboard

---

## 2. Bulk Import of 80,000 Freelancers

**Cost Estimate:** 80,000 x $0.01 = ~$800 in OpenAI API costs

### Bubble Workflow: `bulk-upsert-users`

**Configuration:**
- Endpoint name: `bulk-upsert-users`
- No parameters (processes all users with missing capsules)

**Steps:**
1. Search for Users where `capsule_domain_vectorID` is empty, limit 50
2. Schedule `upsert-capsules-user` for each user (1-second delay between)
3. Only when: Step 1's count = 50, schedule `bulk-upsert-users` for +60 seconds

**Rate:** ~50 users/minute = ~27 hours for 80,000 users

### Actions:
- [ ] Create `bulk-upsert-users` backend workflow in Bubble
- [ ] Test with 10 users first
- [ ] Run full bulk import (monitor via Admin Dashboard)
- [ ] Verify user count matches expected (~80,000)

---

## 3. Agency Handling (Bubble-Only)

**Decision:** Handle agencies separately in Bubble, not through the Render matching service.

**Rationale:** There aren't many agencies, and they just need simple location/language matching (no semantic matching needed).

### Approach: Separate Bubble Workflow for Agencies

When a job is posted:
1. **Freelancers:** Use the Render service (semantic matching, expertise scoring)
2. **Agencies:** Use a separate Bubble workflow that:
   - Filters agencies by `country` matching job's available countries
   - Filters by `language` matching job's available languages
   - Sends notifications to matching agencies

### Bubble Workflow: `notify-agencies-for-job`

**Trigger:** Called when job is posted (alongside the Render notify call)

**Steps:**
1. Search for Users where `lblrType_Agency/Freelancer` = Agency
2. Filter: `userCountry` is in Job's `AvailableCountries`
3. Filter: `lblr_Languages` contains any of Job's `AvailableLanguages`
4. Schedule email notifications for matching agencies

### Actions:
- [ ] Create `notify-agencies-for-job` backend workflow in Bubble
- [ ] Wire it to job posting flow (when job targets agencies)
- [ ] Test with a few agencies

---

## 4. Existing Jobs on Live (~200 jobs)

**Current State:** ~200 jobs exist in Bubble but not in the job matching system.

### Approach: Bulk Sync Existing Jobs

1. **Create `bulk-upsert-jobs` backend workflow in Bubble:**
   - Similar to user bulk import
   - Process jobs where `capsule_domain_vectorID` is empty
   - Rate limit to avoid hitting API limits

2. **Set Active Status:**
   - After upsert, call `/admin/sync-active-jobs` with list of active job IDs
   - This marks jobs as active in the qualification tracking

3. **Evaluate Users for Existing Jobs:**
   - For each existing job, run re-notify to populate qualifications
   - Or: Let the system catch up naturally as users browse

### Actions:
- [ ] Create `bulk-upsert-jobs` backend workflow in Bubble
- [ ] Run bulk sync for all existing jobs
- [ ] Call sync-active-jobs with active job IDs
- [ ] Verify job count in Admin Dashboard

---

## 5. Pre-Deployment Bubble Wiring

These items from `docs/bubble-implementation-checklist.md` need completion:

### Phase 8: Pre-Deployment Tasks
- [ ] Step 23: Wire up new job creation to call `upsert-capsules-job` with `source: "new_job"`
- [ ] Step 24: Wire up new user signup to call `upsert-capsules-user` with `source: "new_user"`
- [ ] Step 25: Schedule `sync-active-jobs-to-render` recurring event (every 2 hours)

### Phase 7: Testing (Optional but Recommended)
- [ ] Step 18-22: Test debounced sync flows

### Phase 9: Recommended Jobs Testing
- [ ] Step 31-37: Verify recommended jobs feature works end-to-end

---

## 6. Post-Deployment Verification

### Admin Dashboard Checks:
- [ ] Overview tab shows correct counts (active jobs, pending notifications)
- [ ] Sync tab shows recent sync activity
- [ ] Monitoring tab shows re-notify and recommended-jobs events

### Functional Tests:
- [ ] Create a test job in Bubble -> verify it appears in Admin Dashboard
- [ ] Edit a test user profile -> verify sync triggers
- [ ] Post a new job -> verify users get notified (check email workflow triggers)
- [ ] Verify recommended jobs populate for users

---

## 7. Deployment Sequence

**Suggested order:**

### Phase A: Data Cleanup (Do First)
1. [ ] Delete all vectors from Pinecone index
2. [ ] Truncate PostgreSQL tables via Render shell

### Phase B: Bulk Import Workflows (Build in Bubble)
3. [ ] Create `bulk-upsert-jobs` workflow
4. [ ] Create `bulk-upsert-users` workflow
5. [ ] Create `notify-agencies-for-job` workflow

### Phase C: Run Bulk Imports
6. [ ] Run bulk job import (~200 jobs)
7. [ ] Call sync-active-jobs with active job IDs
8. [ ] Run bulk user import (~80,000 users, 24-48 hours background)

### Phase D: Production Wiring
9. [ ] Wire new job creation to `upsert-capsules-job` with `source: "new_job"`
10. [ ] Wire new user signup to `upsert-capsules-user` with `source: "new_user"`
11. [ ] Set up Render Cron Job for daily active jobs sync (see below)

### Phase E: Go Live
12. [ ] Verify via Admin Dashboard
13. [ ] Enable triggers for new jobs/users
14. [ ] Monitor for first few days

---

## 8. Render Cron Job: Daily Active Jobs Sync

Instead of using Bubble recurring events, Render calls Bubble's Data API directly to sync active jobs.

### Environment Variables (add to Render)

```
BUBBLE_API_KEY=a4e7cad588eaaa32fab03a418cd18dc4
BUBBLE_API_URL=https://app.opentrain.ai/api/1.1/obj
```

### Create Cron Job in Render Dashboard

1. Go to Render Dashboard → **New** → **Cron Job**
2. Configure:
   - **Name:** `sync-active-jobs-daily`
   - **Schedule:** `0 6 * * *` (6 AM UTC daily, or choose your preferred time)
   - **Command:**
     ```bash
     curl -X POST https://user-capsule-upsert-service.onrender.com/admin/sync-active-jobs-from-bubble \
       -H "Authorization: Bearer $SERVICE_API_KEY" \
       -H "Content-Type: application/json"
     ```
   - **Environment:** Link to the same environment group as the main service

### Manual Trigger (for testing)

```bash
curl -X POST https://user-capsule-upsert-service.onrender.com/admin/sync-active-jobs-from-bubble \
  -H "Authorization: Bearer YOUR_SERVICE_API_KEY" \
  -H "Content-Type: application/json"
```

### What It Does

1. Fetches all active jobs from Bubble (Published=true, AcceptingApplicants=true, not ExampleJob, not Archived)
2. Updates our database: marks fetched jobs as active, marks missing jobs as inactive
3. Returns stats: `{ fetched_from_bubble, activated, deactivated, created, unchanged }`

---

## Decisions Made

| # | Question | Decision |
|---|----------|----------|
| 1 | Development data | **Fresh start** - clear Pinecone and database |
| 2 | Bulk import approach | **Bubble workflow** - no Render code changes needed |
| 3 | Agency targeting | **Bubble-only** - separate workflow, filter by location/language only |
| 4 | Existing jobs | Bulk sync now |

---

## Summary: No Render Code Changes Needed

All remaining work is:
1. **Pinecone/Database cleanup** (one-time manual step)
2. **Bubble workflows** for bulk import and agency handling
3. **Bubble wiring** for production triggers
