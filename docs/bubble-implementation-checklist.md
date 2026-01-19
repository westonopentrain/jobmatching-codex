# Bubble Implementation Checklist: Debounced Re-Sync

This checklist tracks the step-by-step implementation of debounced capsule re-sync in Bubble.

---

## Phase 1: Data Model Setup

- [x] **Step 1:** Add `capsules_stale` (yes/no, default: no) to User data type
- [x] **Step 2:** Add `capsules_metadata_stale` (yes/no, default: no) to User data type
- [x] **Step 3:** Add `capsules_stale` (yes/no, default: no) to Job data type
- [x] **Step 4:** Add `capsules_metadata_stale` (yes/no, default: no) to Job data type

---

## Phase 2: API Connector Setup

- [x] **Step 5:** Add `update_user_metadata` API call (PATCH /v1/users/:user_id/metadata)
- [x] **Step 6:** Add `update_job_metadata` API call (PATCH /v1/jobs/:job_id/metadata)

---

## Phase 3: Backend Workflows

- [x] **Step 7:** Create `update-user-metadata` backend workflow
- [x] **Step 8:** Create `update-job-metadata` backend workflow
- [x] **Step 9:** Create `sync_stale_user_capsules` backend workflow (processes stale users)
- [x] **Step 10:** Create `sync_stale_job_capsules` backend workflow (processes stale jobs)

---

## Phase 4: Scheduled Events

- [x] ~~**Step 11:** Create recurring event for jobs~~ **SKIPPED** - using event-driven approach instead
- [x] ~~**Step 12:** Create recurring event for users~~ **SKIPPED** - using event-driven approach instead

---

## Phase 5: Trigger Workflows (Event-Driven for Both Users and Jobs)

Both users and jobs use event-driven sync for immediate notifications when profiles/jobs change.

### Users (Event-Driven - schedules sync with 10-min delay)
- [x] **Step 12:** Add database trigger `user-content-changed`: When User content fields change → set `capsules_stale = yes` + schedule `upsert-capsules-user` in 10 minutes
- [x] **Step 13:** Add database trigger `user-metadata-changed`: When User metadata fields change → set `capsules_metadata_stale = yes` + schedule `update-user-metadata` in 10 minutes

### Jobs (Event-Driven - schedules sync with 10-min delay)
- [x] **Step 14:** Add database trigger `job-content-changed`: When Job content fields change → set `capsules_stale = yes` + schedule `upsert-capsules-job` in 10 minutes
- [x] **Step 15:** Add database trigger `job-metadata-changed`: When Job metadata fields change → set `capsules_metadata_stale = yes` + schedule `update-job-metadata` in 10 minutes

---

## Phase 6: Update Existing Workflows

- [x] **Step 16:** Update `upsert-capsules-user` to clear stale flags on success *(completed earlier)*
- [x] **Step 17:** Update `upsert-capsules-job` to clear stale flags on success *(completed earlier)*

---

## Phase 7: Testing

- [ ] **Step 18:** Test: Edit user profile content field → verify `capsules_stale = yes` + upsert scheduled in 10 min
- [ ] **Step 19:** Test: Wait 10 minutes → verify user gets re-upserted and flags clear
- [ ] **Step 20:** Test: Edit user country only → verify `capsules_metadata_stale = yes` + metadata update scheduled
- [ ] **Step 21:** Test: Edit job content field → verify `capsules_stale = yes` + upsert scheduled in 10 min
- [ ] **Step 22:** Test: Edit job countries/languages → verify `capsules_metadata_stale = yes` + metadata update scheduled

---

## Phase 8: Pre-Deployment Tasks

These tasks need to be completed before going live:

- [ ] **Step 23:** Wire up new job creation to call `upsert-capsules-job` with `source: "new_job"`
- [ ] **Step 24:** Wire up new user signup to call `upsert-capsules-user` with `source: "new_user"`
- [ ] **Step 25:** Schedule `sync-active-jobs-to-render` recurring event (every 2 hours)
  - Workflow already created, just needs to be scheduled in Settings → Scheduler
  - Syncs active job IDs to Render so qualification tracking knows which jobs are open

---

## Sync Source Values Reference

| Trigger | Source Value | Status |
|---------|--------------|--------|
| `job-content-changed` trigger | `"scheduled_content"` | ✅ Done |
| `job-metadata-changed` trigger | `"scheduled_metadata"` | ✅ Done |
| `user-content-changed` trigger | `"scheduled_content"` | ✅ Done |
| `user-metadata-changed` trigger | `"scheduled_metadata"` | ✅ Done |
| Manual "Upsert" button for jobs | `"manual"` | ✅ Done |
| Manual "Upsert" button for users | `"manual"` | ✅ Done |
| New job posted on platform | `"new_job"` | ⏳ Pre-deployment |
| New user signs up | `"new_user"` | ⏳ Pre-deployment |

---

## Phase 9: Recommended Jobs for Users

This feature populates `lblr_recommended_jobs` on User with jobs sorted by match score, using intelligent tier-aware thresholds.

### Render API (Already Built)

- [x] **Endpoint:** `GET /v1/users/:userId/recommended-jobs`
  - Returns job IDs pre-filtered by `above_threshold` and sorted by score (best first)
  - Uses tier-aware thresholds:
    - Specialists: 45% threshold for generic jobs, 50% for specialized
    - Generalists: 35% threshold for generic jobs, 50% for specialized
  - Response includes:
    - `job_ids`: Simple list of job IDs for easy Bubble integration
    - `jobs`: Detailed list with scores and thresholds
    - `user_expertise_tier`: User's tier for debugging
    - `count`, `total_above_threshold`: Stats
  - Optional `?limit=N` query param to limit results

### Bubble Implementation (To Do)

#### Step 26: Add API Connector

- [ ] Add `Get recommended jobs for user` API call
  - Method: `GET`
  - URL: `https://your-render-url/v1/users/[user_id]/recommended-jobs`
  - Headers: `Authorization: Bearer [api_key]`
  - Parameters: `user_id` (required, path)

#### Step 27: Create Backend Workflow `update-recommended-jobs-for-user`

**Configuration:**
- Endpoint name: `update-recommended-jobs-for-user`
- Parameter: `user` (User type, required)
- Ignore privacy rules: Yes

**Step 1: Call Get recommended jobs for user API**
- `user_id`: user's unique id

**Step 2: Make changes to User**
- Thing to change: `user` parameter
- `lblr_recommended_jobs` set list = Search for Jobs where:
  - `unique id` is in `Result of step 1's job_ids`
  - `:sorted by` Result of step 1's job_ids order (preserve API sort order)

*Note: The API returns jobs pre-sorted by score, so just preserving the order maps correctly.*

#### Step 28: Wire Trigger - After User Profile Update

Modify `upsert-capsules-user` workflow:
- [ ] Add Step 3: Schedule API workflow `update-recommended-jobs-for-user`
  - user: User parameter
  - Scheduled date: Current date/time

#### Step 29: Wire Trigger - After New Job Posted

Modify `upsert-capsules-job` workflow (after the re-notify step):
- [ ] Add Step 5: Schedule API workflow on a list `update-recommended-jobs-for-user`
  - List to run on: Search for Users where unique id is in Result of step 3's `newly_qualified_user_ids`
  - user: This User
  - Scheduled date: Current date/time
  - Only when: Result of step 3's `newly_qualified_user_ids:count > 0`

#### Step 30: Wire Trigger - New Job Notifications

Modify the notify flow for brand new jobs:
- [ ] After emails sent, schedule `update-recommended-jobs-for-user` for qualifying users

### Triggers Summary

| Trigger | Action |
|---------|--------|
| User completes onboarding | Call `update-recommended-jobs-for-user` |
| User updates profile | Auto-triggered via `upsert-capsules-user` |
| New job posted | Updates qualifying users via `upsert-capsules-job` |
| Job edited (newly qualifying users) | Updates via re-notify step |

### Verification Tests

- [ ] **Step 31:** Test: Call `update-recommended-jobs-for-user` for a test user → verify `lblr_recommended_jobs` is populated
- [ ] **Step 32:** Test: Verify jobs are sorted by match score (best first)
- [ ] **Step 33:** Test: Edit user profile → verify `lblr_recommended_jobs` refreshes automatically
- [ ] **Step 34:** Test: Post a new job → verify qualifying users' `lblr_recommended_jobs` includes the new job
- [ ] **Step 35:** Test: Specialist user sees fewer generic jobs than a generalist user (tier-aware thresholds)

---

## Current Progress

**Completed:** Steps 1-17 (Data model, API, sync workflows, upsert updates, database triggers), Step 26 (Recommended jobs API)
**Next Step:** Step 18 (Testing), Step 23-24 (Pre-deployment wiring), or Step 27-30 (Recommended jobs Bubble workflows)
