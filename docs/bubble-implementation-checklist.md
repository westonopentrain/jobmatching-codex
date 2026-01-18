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

## Current Progress

**Completed:** Steps 1-17 (Data model, API, sync workflows, upsert updates, database triggers)
**Next Step:** Step 18 (Testing) or Step 23-24 (Pre-deployment wiring)
