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

When users edit their profiles or jobs are updated, we use a debouncing pattern to avoid excessive API calls. Instead of calling the API immediately on every save, we mark records as "stale" and process them in batches.

### Why Debouncing?

| Scenario | Without Debouncing | With Debouncing |
| -------- | ------------------ | --------------- |
| User saves profile 5 times in 1 minute | 5 API calls = $0.05 | 1 API call = $0.01 |
| User changes only country | Full upsert = $0.01 | Metadata update = $0.001 |

### Cost Breakdown

| Operation | Cost | When to Use |
| --------- | ---- | ----------- |
| Full upsert (`POST /v1/users/upsert`) | ~$0.01 | Content changes (resume, work experience, education, labeling experience) |
| Metadata update (`PATCH /v1/users/:id/metadata`) | ~$0.001 | Only country or languages changed |

### Workflow 1: Set Stale Flags on Field Changes

Create database triggers or workflow events that fire when User fields change:

**For content fields** (resume_text, work_experience, education, labeling_experience):
```
When User's [field] is changed:
  → Make changes to User:
    → capsules_stale = yes
    → capsules_metadata_stale = no
```

**For metadata fields** (country, languages):
```
When User's country is changed:
  → Only when: User's capsules_stale is "no"
  → Make changes to User:
    → capsules_metadata_stale = yes
```

> **Note:** If `capsules_stale` is already `yes`, don't set `capsules_metadata_stale` because the full upsert will update metadata anyway.

### Workflow 2: Scheduled Batch Re-Sync

Create a **Recurring Event** that runs every 10 minutes:

**Backend Workflow:** `sync_stale_capsules`

**Step 1: Process full re-upserts**
```
Search for Users where capsules_stale = yes (limit 50)
For each User:
  → Schedule API workflow: upsert-capsules-user
  → On success: set capsules_stale = no, capsules_metadata_stale = no
```

**Step 2: Process metadata-only updates**
```
Search for Users where:
  - capsules_metadata_stale = yes
  - capsules_stale = no
  (limit 100)

For each User:
  → Schedule API workflow: update_user_metadata
  → On success: set capsules_metadata_stale = no
```

### Workflow 3: Backend Workflow for Metadata Update

**Backend Workflow:** `update-user-metadata`
- Endpoint name: `update-user-metadata`
- Parameter: `User` (type: User, required)
- Ignores privacy rules: Yes

**Step 1: Call Render Service**
- Action: "Render - Job Matching - update_user_metadata"
- `user_id` = User's unique id
- `country` = User's userCountry's Display
- `languages` = User's lblr_Languages

**Step 2: Clear stale flag**
- Action: "Make changes to User..."
- Only when: Result of step 1's status is "ok"
- `capsules_metadata_stale` = no

### Same Pattern for Jobs

Apply the same debouncing pattern to Jobs:
1. Set `capsules_stale = yes` when title/description/requirements change
2. Set `capsules_metadata_stale = yes` when only country/language filters change
3. Scheduled workflow processes stale jobs every 10 minutes
