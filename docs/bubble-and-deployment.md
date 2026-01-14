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

| Field name              | Type | Description |
| ----------------------- | ---- | ----------- |
| `capsule.domain.text`   | text | Domain capsule text returned from the upsert service. |
| `capsule.domain.vectorID` | text | Pinecone vector ID for the domain embedding. |
| `capsule.task.text`     | text | Task capsule text returned from the upsert service. |
| `capsule.task.vectorID` | text | Pinecone vector ID for the task embedding. |
| `capsule.updated.at`    | date | Timestamp saved from the `updated_at` value in the API response. |

Each time Bubble calls `POST /v1/users/upsert`, update these fields with the values returned in the response body. Do **not** persist embedding vectors in Bubble—vectors remain in Pinecone.

## Bubble Job fields

Jobs that operators upsert from Bubble now save the capsule metadata on the **Job** data type using these fields:

| Field name                 | Type | Description |
| -------------------------- | ---- | ----------- |
| `capsule_domain_text`      | text | Domain capsule text returned from the job upsert response. |
| `capsule_domain_vectorID`  | text | Identifier for the Pinecone domain vector returned in the upsert response. |
| `capsule_task_text`        | text | Task capsule text returned from the job upsert response. |
| `capsule_task_vectorID`    | text | Identifier for the Pinecone task vector returned in the upsert response. |
| `capsule_updated_at`       | date | Timestamp copied from the `updated_at` value in the API response. |

Persist only the capsule texts, vector IDs, and timestamp—embedding vectors continue to live exclusively in Pinecone.

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
