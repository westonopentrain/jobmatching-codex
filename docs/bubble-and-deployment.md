# Bubble Data Model & Render Deployment Notes

## Bubble Workflows

### Job Upsert Workflow (Testing)

**Trigger**: Click "Upsert Job" button (Group Send to Upsert)

**Backend Workflow**: `upsert-capsules-job`
- Endpoint name: `upsert-capsules-job`
- Parameter: `job` (type: Job, required)
- Ignores privacy rules: Yes
- Response type: JSON Object

**Step 1: Call Render Service**
- Action: "Render - Job Matching - upsert_job_capsules"
- API Connector: `upsert_job_capsules`
- Endpoint: `POST /v1/jobs/upsert`
- Request body:
  ```json
  {
    "job_id": "<job's unique id>",
    "title": "<job's Title>",
    "fields": {
      "Instructions": "<concatenated job text>"
    }
  }
  ```
- The `Instructions` field contains all job details concatenated:
  - Title, Dataset Description, Data_SubjectMatter, LabelInstruct/Descri, Requirements_Additional

> **Note:** The API supports individual fields (`fields.Dataset_Description`, `fields.Data_SubjectMatter`, etc.) but combining everything into `fields.Instructions` works fine since the LLM parses the text directly.

**Step 2: Save Response to Job**
- Action: "Make changes to Job..."
- Updates the Job record with:
  - `capsule_domain_text` = Response's domain.capsule_text
  - `capsule_domain_vectorID` = Response's domain.vector_id
  - `capsule_task_text` = Response's task.capsule_text
  - `capsule_task_vectorID` = Response's task.vector_id
  - `capsule_updated_at` = Current date/time

### Save Applicant Score Row Workflow

**Backend Workflow**: `save_applicant_score_row`
- Endpoint name: `save_applicant_score_row`
- Ignores privacy rules: Yes
- Only when: user is not empty

**Parameters:**
| Key | Type | Description |
| --- | ---- | ----------- |
| `run` | JobScoreRun | Parent scoring run |
| `job` | Job | The job being scored |
| `user` | User | The user being scored |
| `s_domain` | number | Domain similarity score |
| `s_task` | number | Task similarity score |
| `final` | number | Weighted final score |
| `rank` | number | Position in results |
| `threshold` | number | Score threshold (for above_threshold calculation) |

**Step 1: Create a new ApplicantScore**
- Only when: `Search for ApplicantScores:count is 0` (prevents duplicates)
- Creates ApplicantScore with: `run`, `job`, `user`

**Step 2: Make changes to ApplicantScore**
- Thing to change: `Search for ApplicantScores:first item`
- Updates:
  - `s_domain` = s_domain
  - `s_task` = s_task
  - `final` = final
  - `rank` = rank
  - `above_threshold` = final is not empty and (final >= threshold)

> **Note:** This is an upsert pattern - creates record if it doesn't exist, then updates scores. Called by `score_applicants_for_job` for each result from the scoring API response.

---

### Score Applicants for Job Workflow

**Backend Workflow**: `score_applicants_for_job`
- Endpoint name: `score_applicants_for_job`
- Ignores privacy rules: Yes

**Parameters:**
| Key | Type | List | Description |
| --- | ---- | ---- | ----------- |
| `job` | Job | No | The job to score candidates against |
| `w_domain` | number | No | Domain weight (0-1) |
| `w_task` | number | No | Task weight (0-1) |
| `threshold` | number | No | Minimum score threshold |
| `users` | User | Yes | List of users to score |

**Step 1: Create a new JobScoreRun**
- Type: JobScoreRun
- `job` = job
- `w_domain` = w_domain
- `w_task` = w_task
- `threshold_used` = threshold
- `requested_at` = Current date/time

**Step 2: Render - Job Matching - Score users for job**
- API Connector: `Score users for job`
- `job_id` = job's unique id
- `w_domain` = w_domain
- `w_task` = w_task
- `topK` = users:count
- `threshold` = threshold
- `candidate_ids_json` = users:each item's unique id (formatted as comma-separated quoted strings)

**Step 3: Make changes to JobScoreRun**
- Thing to change: Result of step 1
- `results_count` = Result of step 2's results:count
- `elapsed_ms` = Result of step 2's elapsed_ms

**Step 4: Schedule API Workflow save_applicant_score_row on a list**
- Type of things: Score users for job result
- List to run on: Result of step 2's results
- API Workflow: `save_applicant_score_row`
- Parameters for each result:
  - `run` = Result of step 1
  - `job` = job
  - `user` = Search for Users:first item (where unique id = This result's user_id)
  - `s_domain` = This result's s_domain
  - `s_task` = This result's s_task
  - `final` = This result's final
  - `rank` = This result's rank
  - `threshold` = threshold

> **Note:** This workflow orchestrates the full scoring process: creates a parent JobScoreRun, calls the Render API, and creates ApplicantScore records for each result.

---

### User Upsert Workflow

**Backend Workflow**: `upsert-capsules-user`
- Endpoint name: `upsert-capsules-user`
- Parameter: `User` (type: User, required)
- Ignores privacy rules: Yes
- Response type: JSON Object

**Step 1: Call Render Service**
- Action: "Render - Job Matching - upsert_user_capsules"
- API Connector: `upsert_user_capsules`
- Endpoint: `POST /v1/users/upsert`
- Request body:
  ```json
  {
    "user_id": "<User's unique id>",
    "resume_text": "<User's resume_text>",
    "work_experience": ["<User's lblr_freelancerWorkExperience>"],
    "education": ["<User's lblr_Education>"],
    "labeling_experience": ["<User's lblr_LabelExperience>"],
    "country": "<User's userCountry's Display>",
    "languages": ["<User's lblr_Languages>"]
  }
  ```

> **Note:** The API supports aliases: `label_experience` → `labeling_experience`, `language` → `languages`

> **Note:** `resume_text` is optional. If empty, the API builds profile text from `work_experience`, `education`, and `labeling_experience` fields. At least one field must have data.

**Step 2: Save Response to User**
- Action: "Make changes to User..."
- Updates the User record with:
  - `capsule.domain.text` = Response's domain.capsule_text
  - `capsule.domain.vectorID` = Response's domain.vector_id
  - `capsule.task.text` = Response's task.capsule_text
  - `capsule.task.vectorID` = Response's task.vector_id
  - `capsule.updated.at` = Current date/time

---

## Bubble User fields

The Bubble application stores capsule metadata on the **User** data type using the following fields:

### Capsule Data (populated from API response)

| Field name              | Type | Description |
| ----------------------- | ---- | ----------- |
| `capsule.domain.text`   | text | Domain capsule text returned from the upsert service. |
| `capsule.domain.vectorID` | text | Pinecone vector ID for the domain embedding. |
| `capsule.task.text`     | text | Task capsule text returned from the upsert service. |
| `capsule.task.vectorID` | text | Pinecone vector ID for the task embedding. |
| `capsule.updated_at`    | date | Timestamp saved from the `updated_at` value in the API response. Tracks when capsules were last synced. |

### Stale Tracking (for debounced re-sync)

| Field name              | Type    | Default | Description |
| ----------------------- | ------- | ------- | ----------- |
| `capsules_stale`        | yes/no  | no      | Set to `yes` when content fields change (resume, work experience, education, labeling experience). Triggers full re-upsert. |
| `capsules_metadata_stale` | yes/no | no     | Set to `yes` when only metadata fields change (country, languages). Triggers metadata-only update (cheaper). |

> **Note:** `capsule.updated_at` serves as the "last synced" timestamp. A separate `capsules_last_synced` field is redundant and not needed.

Each time Bubble calls `POST /v1/users/upsert`, update the capsule fields with the values returned in the response body and clear both stale flags. Do **not** persist embedding vectors in Bubble—vectors remain in Pinecone.

### Which User Fields Trigger Stale Flags

| Field Changed | Set `capsules_stale` | Set `capsules_metadata_stale` |
| ------------- | -------------------- | ----------------------------- |
| `resume_text` | yes | no |
| `work_experience` / `lblr_freelancerWorkExperience` | yes | no |
| `education` / `lblr_Education` | yes | no |
| `labeling_experience` / `lblr_LabelExperience` | yes | no |
| `country` / `userCountry` | no | yes (only if `capsules_stale` is no) |
| `languages` / `lblr_Languages` | no | yes (only if `capsules_stale` is no) |

**Logic:** Content changes require full re-upsert (~$0.01). Metadata-only changes can use the cheaper PATCH endpoint (~$0.001).

## Bubble Job fields

Jobs that operators upsert from Bubble now save the capsule metadata on the **Job** data type using these fields:

### Capsule Data (populated from API response)

| Field name                 | Type | Description |
| -------------------------- | ---- | ----------- |
| `capsule_domain_text`      | text | Domain capsule text returned from the job upsert response. |
| `capsule_domain_vectorID`  | text | Identifier for the Pinecone domain vector returned in the upsert response. |
| `capsule_task_text`        | text | Task capsule text returned from the job upsert response. |
| `capsule_task_vectorID`    | text | Identifier for the Pinecone task vector returned in the upsert response. |
| `capsule_updated_at`       | date | Timestamp copied from the `updated_at` value in the API response. Tracks when capsules were last synced. |

### Stale Tracking (for debounced re-sync)

| Field name              | Type    | Default | Description |
| ----------------------- | ------- | ------- | ----------- |
| `capsules_stale`        | yes/no  | no      | Set to `yes` when content fields change (title, description, requirements). Triggers full re-upsert. |
| `capsules_metadata_stale` | yes/no | no     | Set to `yes` when only filter fields change (countries, languages). Triggers metadata-only update (cheaper). |

### Which Job Fields Trigger Stale Flags

| Field Changed | Set `capsules_stale` | Set `capsules_metadata_stale` |
| ------------- | -------------------- | ----------------------------- |
| `Title` | yes | no |
| `Dataset_Description` | yes | no |
| `Data_SubjectMatter` | yes | no |
| `LabelInstruct/Descri` / `Instructions` | yes | no |
| `Requirements_Additional` | yes | no |
| `AvailableCountries` | no | yes (only if `capsules_stale` is no) |
| `AvailableLanguages` | no | yes (only if `capsules_stale` is no) |

Persist only the capsule texts, vector IDs, and timestamp—embedding vectors continue to live exclusively in Pinecone.

## Scoring Data Types

Two data types work together to store matching results:

### JobScoreRun (Parent)

Stores metadata about each scoring run. One record per API call.

| Field name          | Type        | Description |
| ------------------- | ----------- | ----------- |
| `job`               | Job         | The job that was scored |
| `w_domain`          | number      | Domain weight used (0-1) |
| `w_task`            | number      | Task weight used (0-1) |
| `threshold_used`    | number      | Score threshold if specified |
| `results_count`     | number      | Total results returned |
| `count_gte_threshold` | number    | Count of results >= threshold |
| `elapsed_ms`        | number      | API response time |
| `request_id`        | text        | API request ID for debugging |
| `requested_at`      | date        | When the scoring was run |

### ApplicantScore (Child)

Stores individual user scores, linked to a JobScoreRun. One record per user scored.

| Field name        | Type         | Description |
| ----------------- | ------------ | ----------- |
| `run`             | JobScoreRun  | Parent scoring run |
| `job`             | Job          | The job (denormalized for easier queries) |
| `user`            | User         | The scored user |
| `s_domain`        | number       | Domain similarity score (0-1) |
| `s_task`          | number       | Task similarity score (0-1) |
| `final`           | number       | Weighted final score |
| `rank`            | number       | Position in results (1 = highest) |
| `above_threshold` | yes/no       | Whether score >= threshold |

### Relationship

```
JobScoreRun (1 per scoring request)
    ├── ApplicantScore (user A, rank 1)
    ├── ApplicantScore (user B, rank 2)
    ├── ApplicantScore (user C, rank 3)
    └── ... (one per candidate)
```

### Usage

**To display scores for a job:**
```
Search for ApplicantScores where run = [JobScoreRun for this job]:sorted by rank
```

**To compare scoring runs:**
```
Search for JobScoreRuns where job = [current job]:sorted by requested_at descending
```

## Render service reference

| Property | Value |
| -------- | ----- |
| Service URL | `https://user-capsule-upsert-service.onrender.com` |
| Service ID  | `srv-d3b0vpffte5s739citc0` |

Use the URL as the base endpoint for Bubble, Postman, or curl smoke tests. The Service ID is helpful when opening Render support tickets or when using the Render CLI.

---

## Bubble API Connector Configuration

### upsert_job_capsules

| Property | Value |
| -------- | ----- |
| Name | `upsert_job_capsules` |
| Use as | Action |
| Data type | JSON |
| Method | POST |
| URL | `https://user-capsule-upsert-service.onrender.com/v1/jobs/upsert` |
| Body type | JSON |

**Body template:**
```json
{
  "job_id": "<Current-Job-unique-ID>",
  "title": "<Current-Job-Title>",
  "fields": {
    "Instructions": "<Current-Job-full-posting-text>"
  }
}
```

**Body parameters:**
| Key | Description |
| --- | ----------- |
| `Current-Job-unique-ID` | The Bubble unique ID of the Job |
| `Current-Job-Title` | The job's Title field |
| `Current-Job-full-posting-text` | Concatenated text: Title + Dataset Description + Subject Matter + Instructions + Requirements |

### upsert_user_capsules

| Property | Value |
| -------- | ----- |
| Name | `upsert_user_capsules` |
| Use as | Action |
| Data type | JSON |
| Method | POST |
| URL | `https://user-capsule-upsert-service.onrender.com/v1/users/upsert` |
| Body type | JSON |

**Body template:**
```json
{
  "user_id": "<user_id>",
  "resume_text": "<resume_text>",
  "work_experience": ["<work_experience>"],
  "education": ["<education>"],
  "labeling_experience": ["<label_experience>"],
  "country": "<country>",
  "languages": ["<language>"]
}
```

**Body parameters:**
| Key | Description | Allow blank |
| --- | ----------- | ----------- |
| `user_id` | User's unique id | No |
| `resume_text` | User's resume_text (JSON-escaped) | Yes |
| `work_experience` | User's lblr_freelancerWorkExperience | Yes |
| `education` | User's lblr_Education | Yes |
| `label_experience` | User's lblr_LabelExperience | Yes |
| `country` | User's userCountry's Display | Yes |
| `language` | User's lblr_Languages | Yes |

> **Note:** If `resume_text` is empty, the API builds profile text from `work_experience`, `education`, and `labeling_experience`. At least one of these must have data.

### Score users for job

| Property | Value |
| -------- | ----- |
| Name | `Score users for job` |
| Use as | Action |
| Data type | JSON |
| Method | POST |
| URL | `https://user-capsule-upsert-service.onrender.com/v1/match/score_users_for_job` |
| Body type | JSON |

**Body template:**
```json
{
  "job_id": "<job_id>",
  "candidate_user_ids": [<candidate_ids_json>],
  "w_domain": <w_domain>,
  "w_task": <w_task>,
  "topK": <topK>,
  "threshold": <threshold>
}
```

**Body parameters:**
| Key | Description | Allow blank |
| --- | ----------- | ----------- |
| `job_id` | The job's unique id | No |
| `candidate_ids_json` | Comma-separated quoted user IDs: `"id1", "id2"` | No |
| `w_domain` | Weight for domain similarity (0-1) | No |
| `w_task` | Weight for task similarity (0-1) | No |
| `topK` | Max results to return | No |
| `threshold` | Min score to include (0-1) | Yes |

> **Tip:** Set `w_domain` and `w_task` based on job type:
> - **Specialized jobs** (require credentials/expertise): `w_domain=0.85, w_task=0.15`
> - **Generic jobs** (labeling tasks): `w_domain=0.3, w_task=0.7`
>
> Or add `auto_weights: true` to let the API determine weights from job classification.

**Response includes:**
- `results[]`: Array of `{ user_id, s_domain, s_task, final, rank }`
- `job_classification`: `{ job_class, required_credentials, subject_matter_codes }`
- `w_domain`, `w_task`: Normalized weights used
- `weights_source`: `"auto"` or `"request"`
- `missing_vectors`: Users without embeddings
- `suggested_threshold`: `{ value, method, min_threshold, percentile_threshold, count_gte_suggested }`

### Score jobs for user

| Property | Value |
| -------- | ----- |
| Name | `Score jobs for user` |
| Use as | Action |
| Data type | JSON |
| Method | POST |
| URL | `https://user-capsule-upsert-service.onrender.com/v1/match/score_jobs_for_user` |
| Body type | JSON |

**Body template:**
```json
{
  "user_id": "<user_id>",
  "job_ids": [<job_ids_json>],
  "auto_weights": true
}
```

**Body parameters:**
| Key | Description | Allow blank |
| --- | ----------- | ----------- |
| `user_id` | User's unique id | No |
| `job_ids_json` | Comma-separated quoted job IDs: `"id1", "id2"` | No |

**Response includes:**
- `results[]`: Array of `{ job_id, job_class, s_domain, s_task, final, rank }`
- `suggested_threshold`: `{ value, method, min_threshold, percentile_threshold, count_gte_suggested }`
- `missing_jobs`: Job IDs without embeddings

### Update user metadata (metadata-only, no LLM)

| Property | Value |
| -------- | ----- |
| Name | `update_user_metadata` |
| Use as | Action |
| Data type | JSON |
| Method | PATCH |
| URL | `https://user-capsule-upsert-service.onrender.com/v1/users/<user_id>/metadata` |
| Body type | JSON |

**Body template:**
```json
{
  "country": "<country>",
  "languages": [<languages>]
}
```

**Body parameters:**
| Key | Description | Allow blank |
| --- | ----------- | ----------- |
| `user_id` | User's unique id (in URL path) | No |
| `country` | User's country | Yes |
| `languages` | Array of language strings | Yes |

> **Note:** At least one of `country` or `languages` must be provided. This endpoint updates Pinecone vector metadata without regenerating capsules or embeddings. Cost: ~$0.001 (vs ~$0.01 for full upsert).

**Response:**
```json
{
  "status": "ok",
  "user_id": "...",
  "updated_metadata": { "country": "...", "languages": [...] },
  "vectors_updated": ["usr_...::domain", "usr_...::task"],
  "elapsed_ms": 123
}
```

### Re-notify job (find newly qualifying users)

| Property | Value |
| -------- | ----- |
| Name | `re_notify_job` |
| Use as | Action |
| Data type | JSON |
| Method | POST |
| URL | `https://user-capsule-upsert-service.onrender.com/v1/jobs/<job_id>/re-notify` |
| Body type | JSON |

**Body template:**
```json
{
  "available_countries": [<countries>],
  "available_languages": [<languages>],
  "max_notifications": 500
}
```

**Body parameters:**
| Key | Description | Allow blank | In URL |
| --- | ----------- | ----------- | ------ |
| `job_id` | Job's unique id | No | Yes (path) |
| `countries` | Comma-separated quoted country names | Yes | No |
| `languages` | Comma-separated quoted language names | Yes | No |

**Response includes:**
- `newly_qualified_user_ids[]`: Array of user IDs who now qualify but weren't previously notified
- `total_qualified`: Total users who currently qualify
- `previously_notified`: Users who were already notified (won't be in the list)
- `elapsed_ms`: Processing time

**Usage:** Call after job upsert to find users who should receive notification emails due to job changes.

---

### Update job metadata (metadata-only, no LLM)

| Property | Value |
| -------- | ----- |
| Name | `update_job_metadata` |
| Use as | Action |
| Data type | JSON |
| Method | PATCH |
| URL | `https://user-capsule-upsert-service.onrender.com/v1/jobs/<job_id>/metadata` |
| Body type | JSON |

**Body template:**
```json
{
  "countries": [<countries>],
  "languages": [<languages>]
}
```

**Body parameters:**
| Key | Description | Allow blank |
| --- | ----------- | ----------- |
| `job_id` | Job's unique id (in URL path) | No |
| `countries` | Array of country filter strings | Yes |
| `languages` | Array of language filter strings | Yes |

> **Note:** At least one of `countries` or `languages` must be provided. This endpoint updates Pinecone vector metadata without regenerating capsules or embeddings. Cost: ~$0.001.

---

## Get Recommended Jobs Workflow

### get_recommended_jobs_for_user

**Backend Workflow**: `get_recommended_jobs_for_user`
- Endpoint name: `get_recommended_jobs_for_user`
- Ignores privacy rules: Yes
- Response type: JSON Object

**Parameters:**
| Key | Type | List | Description |
| --- | ---- | ---- | ----------- |
| `user` | User | No | The user to find jobs for |
| `jobs` | Job | Yes | List of open jobs to score against |

**Step 1: Render - Job Matching - Score jobs for user**
- Action: "Render - Job Matching - Score jobs for user"
- `user_id` = user's unique id
- `job_ids_json` = jobs:format as text
  - Content to show per list item: `"This Job's unique id"`
  - Delimiter: `,`

**Step 2: Make changes to User**
- Thing to change: user
- `lblr_recommended_jobs` set list = Search for Jobs:
  - Type: Job
  - Constraint: `unique id` is in `Result of step 1 (Render - Job Matching...)'s results:filtered's job_id`
  - Filter on results: `final >= Result of step 1's suggested_threshold value`

---

## Additional User Fields for Job Matching

| Field name              | Type | Description |
| ----------------------- | ---- | ----------- |
| `lblr_recommended_jobs` | List of Jobs | Jobs recommended for this user based on matching scores. Updated by `get_recommended_jobs_for_user` workflow. |

---

## Testing the Job Recommendations Workflow

Before wiring `get_recommended_jobs_for_user` to auto-trigger, create a test button to manually verify it works.

### Test Button Setup

1. **Page:** Admin or testing page

2. **Add a Dropdown** to select a user:
   - Type of choices: User
   - Choices source: Search for Users where `capsule.domain.vectorID is not empty`
   - (This filters to only users who have been upserted)

3. **Add a Button** labeled "Test Get Recommended Jobs"

4. **Button Workflow:**
   - **When:** Button is clicked
   - **Action:** Schedule API workflow
   - **API Workflow:** `get_recommended_jobs_for_user`
   - **user:** Dropdown's value
   - **jobs:** Search for Jobs where `capsule_domain_vectorID is not empty`
   - (This filters to only jobs that have been upserted)

### Verification

After clicking the button:
1. Open the selected User in the database
2. Check the `lblr_recommended_jobs` field
3. It should contain jobs that scored above the auto-calculated threshold

### Production Trigger (After Testing)

Once testing confirms the workflow works correctly:
- Wire `get_recommended_jobs_for_user` to trigger after `upsert-capsules-user` completes
- Or schedule it to run periodically for active users

---

## Debounced Re-Sync Workflow

When users edit their profiles or jobs are updated, we use an **event-driven debouncing** pattern. Instead of polling for stale records, we schedule a sync workflow to run X minutes after the edit. This provides true debouncing while enabling immediate notifications when changes are made.

### Why Event-Driven Debouncing?

| Approach | How It Works | Pros | Cons |
| -------- | ------------ | ---- | ---- |
| **Scheduled polling** | Search for stale records every 10 min | Simple | Wastes WU on empty searches; delays up to 10 min |
| **Event-driven** (chosen) | Schedule sync X min after each edit | No wasted searches; predictable delay; enables immediate notifications | Slightly more complex triggers |

### Cost Breakdown

| Operation | Cost | When to Use |
| --------- | ---- | ----------- |
| Full upsert (`POST /v1/users/upsert`) | ~$0.01 | Content changes (resume, work experience, education, labeling experience) |
| Metadata update (`PATCH /v1/users/:id/metadata`) | ~$0.001 | Only country or languages changed |

### Event-Driven Trigger Workflows

Both users and jobs use the same pattern:
1. When fields change → set stale flag + schedule sync workflow in 5 minutes
2. The stale flag prevents duplicate scheduling (only schedule if not already stale)
3. The sync workflow clears the stale flag on success

#### User Content Changes

**Trigger:** When User's content field changes (resume_text, work_experience, education, labeling_experience)

```
When User's [field] is changed:
  → Only when: User's capsules_stale is "no"
  → Make changes to User:
    → capsules_stale = yes
    → capsules_metadata_stale = no
  → Schedule API workflow: upsert-capsules-user
    → user: This User
    → Scheduled date: Current date/time + 5 minutes
```

#### User Metadata Changes

**Trigger:** When User's metadata field changes (country, languages)

```
When User's country/languages is changed:
  → Only when: User's capsules_stale is "no" AND User's capsules_metadata_stale is "no"
  → Make changes to User:
    → capsules_metadata_stale = yes
  → Schedule API workflow: update-user-metadata
    → user: This User
    → Scheduled date: Current date/time + 5 minutes
```

> **Note:** Don't schedule metadata update if `capsules_stale` is already `yes` - the full upsert will handle it.

#### Job Content Changes

**Trigger:** When Job's content field changes (Title, Dataset_Description, Data_SubjectMatter, Instructions, Requirements_Additional)

```
When Job's [field] is changed:
  → Only when: Job's capsules_stale is "no"
  → Make changes to Job:
    → capsules_stale = yes
    → capsules_metadata_stale = no
  → Schedule API workflow: upsert-capsules-job
    → job: This Job
    → Scheduled date: Current date/time + 5 minutes
```

#### Job Metadata Changes

**Trigger:** When Job's metadata field changes (AvailableCountries, AvailableLanguages)

```
When Job's countries/languages is changed:
  → Only when: Job's capsules_stale is "no" AND Job's capsules_metadata_stale is "no"
  → Make changes to Job:
    → capsules_metadata_stale = yes
  → Schedule API workflow: update-job-metadata
    → job: This Job
    → Scheduled date: Current date/time + 5 minutes
```

### Why This Enables Real-Time Notifications

When a job is edited (e.g., a new language is added), the 5-minute debounce ensures:
1. Multiple rapid edits only trigger one sync
2. The sync completes within a predictable window
3. After sync, newly-qualified users can be notified immediately

---

## Implemented Backend Workflows Reference

### sync_stale_user_capsules (Fallback)

**Purpose:** Fallback workflow to process stale user records that weren't caught by event-driven triggers. Can be called manually or by an optional recurring scheduled event for cleanup.

> **Note:** With event-driven triggers in place, this workflow is rarely needed. It serves as a safety net for records that may have been missed.

**Configuration:**
- Endpoint name: `sync_stale_user_capsules`
- Parameters: None
- Ignore privacy rules: Yes

**Step 1: Schedule API Workflow upsert-capsules-user on a list**
- Type of things: User
- List to run on: `Search for Users where capsules_stale = yes :items until #50`
- API Workflow: `upsert-capsules-user`
- User: This User
- Scheduled date: Current date/time

**Step 2: Schedule API Workflow update-user-metadata on a list**
- Type of things: User
- List to run on: `Search for Users where capsules_metadata_stale = yes AND capsules_stale = no :items until #100`
- API Workflow: `update-user-metadata`
- user: This User
- Scheduled date: Current date/time

---

### update-user-metadata

**Purpose:** Updates user metadata in Pinecone without regenerating capsules (cheap ~$0.001).

**Configuration:**
- Endpoint name: `update-user-metadata`
- Parameter: `user` (type: User)
- Ignore privacy rules: Yes

**Step 1: Render - Job Matching - update_user_metadata**
- user_id: `user's unique id`
- country: `user's userCountry's Display`
- languages: `user's lblr_Languages:each item's Language Type:format as text` (content: `"This Language Type_OS's Display"`, delimiter: `,`)

**Step 2: Make changes to User**
- Thing to change: `user`
- Only when: `Result of step 1's status is "ok"`
- capsules_metadata_stale: `no`

---

### update-job-metadata

**Purpose:** Updates job metadata in Pinecone without regenerating capsules (cheap ~$0.001).

**Configuration:**
- Endpoint name: `update-job-metadata`
- Parameter: `job` (type: Job)
- Ignore privacy rules: Yes

**Step 1: Render - Job Matching - update_job_metadata**
- job_id: `job's unique id`
- countries: `job's AvailableCountries:format as text` (content: `"This Countries_OS's Display"`, delimiter: `,`)
- languages: `job's AvailableLanguages:format as text` (content: `"This Language Type_OS's Display"`, delimiter: `,`)

**Step 2: Make changes to Job**
- Thing to change: `job`
- Only when: `Result of step 1's status is "ok"`
- capsules_metadata_stale: `no`

---

### upsert-capsules-user (Updated)

**Added fields to Step 2 (Make changes to User):**
- capsules_stale: `no`
- capsules_metadata_stale: `no`

These fields are cleared after a successful full upsert.

---

### upsert-capsules-job (Updated)

**Added fields to Step 2 (Make changes to Job):**
- capsules_stale: `no`
- capsules_metadata_stale: `no`

These fields are cleared after a successful full upsert.

---

### sync_stale_job_capsules (Fallback)

**Purpose:** Fallback workflow to process stale job records that weren't caught by event-driven triggers. Can be called manually or by an optional recurring scheduled event for cleanup.

> **Note:** With event-driven triggers in place, this workflow is rarely needed. It serves as a safety net for records that may have been missed.

**Configuration:**
- Endpoint name: `sync_stale_job_capsules`
- Parameters: None
- Ignore privacy rules: Yes

**Step 1: Schedule API Workflow upsert-capsules-job on a list**
- Type of things: Job
- List to run on: `Search for Jobs where capsules_stale = yes :items until #50`
- API Workflow: `upsert-capsules-job`
- job: This Job
- Scheduled date: Current date/time

**Step 2: Schedule API Workflow update-job-metadata on a list**
- Type of things: Job
- List to run on: `Search for Jobs where capsules_metadata_stale = yes AND capsules_stale = no :items until #50`
- API Workflow: `update-job-metadata`
- job: This Job
- Scheduled date: Current date/time

---

## Database Trigger Events (Event-Driven Sync)

These database triggers automatically fire when records are modified, providing real-time sync with a 10-minute debounce window.

### user-content-changed

**Purpose:** Triggers a full user re-upsert when profile content changes.

**Configuration:**
- Event type: Database trigger event → A thing is modified
- Type: `User`
- Only when:
  ```
  User before change's capsules_stale is "no"
  and (
    (User before change's resume_text is not User now's resume_text)
    or (User before change's lblr_freelancerWorkExperience:count is not User now's lblr_freelancerWorkExperience:count)
    or (User before change's lblr_Education:count is not User now's lblr_Education:count)
    or (User before change's lblr_LabelExperience:count is not User now's lblr_LabelExperience:count)
  )
  ```

**Step 1: Make changes to User**
- Thing to change: `User now`
- capsules_stale: `yes`
- capsules_metadata_stale: `no`

**Step 2: Schedule API Workflow**
- API Workflow: `upsert-capsules-user`
- user: `User now`
- Scheduled date: `Current date/time + minutes: 10`

---

### user-metadata-changed

**Purpose:** Triggers a metadata-only update when only country/languages change (cheaper than full upsert).

**Configuration:**
- Event type: Database trigger event → A thing is modified
- Type: `User`
- Only when:
  ```
  User before change's capsules_stale is "no"
  and User before change's capsules_metadata_stale is "no"
  and (
    (User before change's userCountry is not User now's userCountry)
    or (User before change's lblr_Languages:each item's Language Type's Display:format as text
        is not User now's lblr_Languages:each item's Language Type's Display:format as text)
  )
  ```

**Step 1: Make changes to User**
- Thing to change: `User now`
- capsules_metadata_stale: `yes`

**Step 2: Schedule API Workflow**
- API Workflow: `update-user-metadata`
- user: `User now`
- Scheduled date: `Current date/time + minutes: 10`

---

### job-content-changed

**Purpose:** Triggers a full job re-upsert when job content changes.

**Configuration:**
- Event type: Database trigger event → A thing is modified
- Type: `Job`
- Only when:
  ```
  Job before change's capsules_stale is "no"
  and (
    (Job before change's Title is not Job now's Title)
    or (Job before change's Dataset Description is not Job now's Dataset Description)
    or (Job before change's Data_SubjectMatter is not Job now's Data_SubjectMatter)
    or (Job before change's LabelInstruct/Descri is not Job now's LabelInstruct/Descri)
    or (Job before change's Requirements_Additional is not Job now's Requirements_Additional)
  )
  ```

**Step 1: Make changes to Job**
- Thing to change: `Job now`
- capsules_stale: `yes`
- capsules_metadata_stale: `no`

**Step 2: Schedule API Workflow**
- API Workflow: `upsert-capsules-job`
- job: `Job now`
- Scheduled date: `Current date/time + minutes: 10`

---

### job-metadata-changed

**Purpose:** Triggers a metadata-only update when only countries/languages filters change.

**Configuration:**
- Event type: Database trigger event → A thing is modified
- Type: `Job`
- Only when:
  ```
  Job before change's capsules_stale is "no"
  and Job before change's capsules_metadata_stale is "no"
  and (
    (Job before change's AvailableCountries:each item's Display:format as text
        is not Job now's AvailableCountries:each item's Display:format as text)
    or (Job before change's AvailableLanguages:each item's Display:format as text
        is not Job now's AvailableLanguages:each item's Display:format as text)
  )
  ```

**Step 1: Make changes to Job**
- Thing to change: `Job now`
- capsules_metadata_stale: `yes`

**Step 2: Schedule API Workflow**
- API Workflow: `update-job-metadata`
- job: `Job now`
- Scheduled date: `Current date/time + minutes: 10`

---

## How Event-Driven Sync Works

1. **User/Job is modified** in Bubble (from any source - profile page, admin, API)
2. **Database trigger fires** and checks if the change affects capsules
3. **Stale flag is set** to prevent duplicate scheduling
4. **Sync workflow is scheduled** for 10 minutes in the future (debouncing)
5. **After 10 minutes**, the scheduled workflow runs:
   - Calls the appropriate API endpoint (upsert or metadata-only)
   - Clears the stale flag on success
6. **If more edits happen** within 10 minutes, they don't schedule new workflows (stale flag is already set)

This provides true debouncing while enabling immediate notifications after changes settle.

---

## Monitoring & Debugging Event-Driven Sync

### Source Tracking Parameter

All upsert and metadata update endpoints now accept an optional `source` parameter to track where each sync originated. This enables distinguishing between manual operations and scheduled syncs in the admin dashboard.

**Valid source values:**
| Source | Description | Status |
| ------ | ----------- | ------ |
| `manual` | User clicked a manual upsert button in Bubble | ✅ Implemented |
| `scheduled_content` | From `user-content-changed` or `job-content-changed` trigger | ✅ Implemented |
| `scheduled_metadata` | From `user-metadata-changed` or `job-metadata-changed` trigger | ✅ Implemented |
| `new_job` | New job posted on the platform | ⏳ Pre-deployment |
| `new_user` | New user signs up | ⏳ Pre-deployment |
| `bulk_import` | Migration or bulk import scripts | As needed |

### Updating Bubble Workflows to Pass Source

#### upsert-capsules-user

Add parameter: `source` (text, optional, default: "manual")

**Step 1 body (API call) becomes:**
```json
{
  "user_id": "<User's unique id>",
  "source": "<source parameter>",
  "resume_text": "<User's resume_text>",
  ...
}
```

The `user-content-changed` database trigger's Step 2 should pass: `source: "scheduled_content"`

#### update-user-metadata

Add parameter: `source` (text, optional, default: "manual")

**Step 1 body (API call) becomes:**
```json
{
  "source": "<source parameter>",
  "country": "<country>",
  "languages": [<languages>]
}
```

The `user-metadata-changed` database trigger's Step 2 should pass: `source: "scheduled_metadata"`

#### upsert-capsules-job and update-job-metadata

Same pattern - add `source` parameter and pass appropriate value from triggers.

### Admin Dashboard Sync Tab

The admin dashboard at `/dashboard` now includes a **Sync** tab that shows:

1. **Last 24h Stats by Source**
   - User upserts: total, scheduled, manual
   - Job upserts: total, scheduled, manual
   - User metadata updates: total, scheduled
   - Job metadata updates: total, scheduled
   - Average latency per operation type

2. **Recent Syncs**
   - Chronological view of all sync activity
   - Type (user_upsert, job_upsert, user_metadata, job_metadata)
   - Source (manual, scheduled_content, scheduled_metadata)
   - Latency
   - Timestamp

### Verifying Event-Driven Sync

1. **Test manual upsert:** Click upsert button → check Sync tab → verify `source: "manual"`
2. **Test scheduled sync:** Edit user profile → wait 10 min → check Sync tab → verify `source: "scheduled_content"`
3. **Test metadata update:** Change user country → wait 10 min → check new entry with `source: "scheduled_metadata"`

### Render Logs

Structured logs now include the source field for easy filtering:

```
{"level":30,"time":1705600000,"event":"upsert.complete","userId":"abc123","source":"scheduled_content","elapsedMs":2340}
```

Filter in Render dashboard:
- `source":"scheduled_content"` - see all scheduled content syncs
- `source":"scheduled_metadata"` - see all scheduled metadata syncs
- `source":"manual"` - see manual operations

---

---

## Email Notification Workflow (Existing)

### email - new job posted - to lblrs

**Purpose:** Sends job notification email to a single user via SendGrid.

**Configuration:**
- Endpoint name: `email - new job posted - to lblrs`
- Ignore privacy rules: Yes
- Response type: JSON Object

**Parameters:**
| Key | Type | Description |
|-----|------|-------------|
| `job` | Job | The job to notify about |
| `ToUser` | User | The user to email |

**Steps:**

The workflow has 3 conditional SendGrid steps based on job payment type:

1. **SendGrid - Send email - PER LABEL** (Only when job is per-label payment)
2. **SendGrid - Send email - PER HOUR** (Only when job is per-hour payment)
3. **SendGrid - Send email - FIXED COST** (Only when job is fixed cost)

All three use the same SendGrid template and substitution tags:

| Substitution Tag | Value |
|------------------|-------|
| `job_name` | job's Title |
| `client_name` | job's Creator's employerCompanyName |
| `client_country` | job's Creator's userCountry's Display |
| `data_type` | job's Data Type's Display |
| `software` | job's LabelSoftware's Display |
| `label_type` | job's LabelType:each item's Display |
| `price` | Arbitrary text (payment amount) |
| `pay_type` | Arbitrary text (payment type label) |
| `profile_photo` | job's Creator's profilePhoto URL |
| `button_url` | Link to job (live vs dev) |

**Email Settings:**
- Template ID: `d-79a5a17d5ab1421e99393fb1ad4f883a`
- From Name: `OpenTrain Alert`
- From Email: `admin@opentrain.ai`
- Subject: Conditional based on user's lblrType_Agency/Freelancer

---

## Job Edit Re-Notification Integration

When a job is edited, we want to notify ONLY users who newly qualify (didn't qualify before the edit). This prevents spamming users who were already notified.

### New API Endpoint

**POST /v1/jobs/:jobId/re-notify**

Returns users who now qualify but weren't previously notified.

```json
// Request
POST /v1/jobs/abc123/re-notify
{
  "available_countries": ["US", "CA"],  // optional
  "available_languages": ["English"],   // optional
  "max_notifications": 500              // optional, default 500
}

// Response
{
  "status": "ok",
  "job_id": "abc123",
  "newly_qualified_user_ids": ["user1", "user2", "user3"],
  "total_qualified": 45,
  "previously_notified": 42,
  "elapsed_ms": 1234
}
```

### Integration with Existing Workflow

To use re-notify with the existing `email - new job posted - to lblrs` workflow:

**Step 1:** Add new API Connector call `re_notify_job` (see API Connector section below)

**Step 2:** Modify `upsert-capsules-job` backend workflow to add steps after the upsert:

```
Existing Step 1: Call Render upsert API
Existing Step 2: Save response to Job

NEW Step 3: Call re_notify_job API
- job_id: job's unique id
- countries: job's AvailableCountries formatted
- languages: job's AvailableLanguages formatted

NEW Step 4: Schedule email workflow on a list
- Only when: Result of step 3's newly_qualified_user_ids:count > 0
- Type of things: text (the user IDs)
- List to run on: Result of step 3's newly_qualified_user_ids
- API Workflow: email - new job posted - to lblrs
- job: job
- ToUser: Search for Users where unique id = This text:first item
```

---

## Job Active Status Sync

Instead of having Bubble call Render every time a job's status changes, we use periodic batch sync. This is simpler for Bubble and works well for a few hundred jobs.

### Option A: Bubble Pushes to Render (Recommended)

Bubble calls Render's sync endpoint periodically (e.g., every 2-4 hours via scheduled workflow).

**Bubble Setup:**

1. **Add API Connector call** `sync_active_jobs`:
   - Method: POST
   - URL: `https://user-capsule-upsert-service.onrender.com/admin/sync-active-jobs`
   - Body type: JSON
   - Body: `{ "active_job_ids": [<job_ids>] }`

2. **Create scheduled recurring workflow** `sync-active-jobs-to-render`:
   - Recurring: Every 2 hours
   - Action: Call `sync_active_jobs` API
   - `job_ids`: `Search for Jobs where [active field] = yes :each item's unique id` formatted as JSON array

**Response from Render:**
```json
{
  "status": "ok",
  "input_count": 150,
  "activated": 5,
  "deactivated": 3,
  "created": 2,
  "unchanged": 140
}
```

### Option B: Render Polls Bubble

If you prefer Render to pull from Bubble:

1. **Expose Bubble API endpoint** `get-active-job-ids` that returns active job IDs
2. **Configure Render cron job** to call it periodically

**Bubble Setup:**

Create a **Backend Workflow** exposed as a public API:

**Workflow:** `get-active-job-ids`
- Endpoint name: `get-active-job-ids`
- Expose as public API workflow: Yes
- Response type: JSON

**Step 1: Return data**
- Data to return: Search for Jobs where [your active status field] = yes
- Format as: `unique id` list

**Render Setup:**

Add environment variable:
- `BUBBLE_API_URL`: `https://[your-bubble-app].bubbleapps.io/api/1.1/wf/get-active-job-ids`

Set up Render cron job to call this endpoint every 2-4 hours.

### What the Sync Does

When `POST /admin/sync-active-jobs` is called with a list of active job IDs:
1. Jobs in the list → marked `isActive: true`
2. Jobs NOT in the list → marked `isActive: false`
3. New job IDs → created with `isActive: true`
4. Updates denormalized `jobActive` field in qualification records

---

## Pre-Deployment Checklist

Before going live, complete these remaining tasks:

- [ ] **Wire up new job creation** to call `upsert-capsules-job` with `source: "new_job"`
- [ ] **Wire up new user signup** to call `upsert-capsules-user` with `source: "new_user"`
- [ ] **Create `get-active-job-ids` API workflow** in Bubble for Render to poll
- [ ] **Add `re_notify_job` API call** to Bubble API Connector
- [ ] **Modify `upsert-capsules-job`** to call re-notify and send emails

See `docs/bubble-implementation-checklist.md` for detailed tracking.
