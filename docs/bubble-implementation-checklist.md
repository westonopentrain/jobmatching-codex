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

- [ ] **Step 5:** Add `update_user_metadata` API call (PATCH /v1/users/:user_id/metadata)
- [ ] **Step 6:** Add `update_job_metadata` API call (PATCH /v1/jobs/:job_id/metadata)

---

## Phase 3: Backend Workflows

- [ ] **Step 7:** Create `update-user-metadata` backend workflow
- [ ] **Step 8:** Create `update-job-metadata` backend workflow
- [ ] **Step 9:** Create `sync_stale_user_capsules` backend workflow (processes stale users)
- [ ] **Step 10:** Create `sync_stale_job_capsules` backend workflow (processes stale jobs)

---

## Phase 4: Scheduled Events

- [ ] **Step 11:** Create recurring event to run `sync_stale_user_capsules` every 10 minutes
- [ ] **Step 12:** Create recurring event to run `sync_stale_job_capsules` every 10 minutes

---

## Phase 5: Trigger Workflows (Set Stale Flags)

- [ ] **Step 13:** Add workflow to set `capsules_stale = yes` when User content fields change
- [ ] **Step 14:** Add workflow to set `capsules_metadata_stale = yes` when User metadata fields change
- [ ] **Step 15:** Add workflow to set `capsules_stale = yes` when Job content fields change
- [ ] **Step 16:** Add workflow to set `capsules_metadata_stale = yes` when Job metadata fields change

---

## Phase 6: Update Existing Workflows

- [ ] **Step 17:** Update `upsert-capsules-user` to clear stale flags on success
- [ ] **Step 18:** Update `upsert-capsules-job` (if exists) to clear stale flags on success

---

## Phase 7: Testing

- [ ] **Step 19:** Test: Edit user profile content field → verify `capsules_stale` becomes `yes`
- [ ] **Step 20:** Test: Wait for scheduled workflow → verify user gets re-upserted and flag clears
- [ ] **Step 21:** Test: Edit user country only → verify `capsules_metadata_stale` becomes `yes`
- [ ] **Step 22:** Test: Wait for scheduled workflow → verify metadata update runs and flag clears

---

## Current Progress

**Completed:** Steps 1-4 (Phase 1: Data Model Setup complete)
**Next Step:** Step 5 (Add `update_user_metadata` API call)
