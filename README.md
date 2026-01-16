# User Capsule Upsert Service

This Fastify service receives Bubble user profile data, generates domain and task capsules with OpenAI, embeds each capsule with `text-embedding-3-large`, and upserts both vectors into Pinecone. It also supports manual Job capsule generation and a lightweight job → candidate scoring endpoint so operators can test roles such as OB-GYN labeling immediately. Bubble receives only the capsule texts, vector identifiers, and metadata required to display and audit updates.

## Capsule Alignment v3 — canonical subareas & domain purity

- Job upsert prompts now demand domain capsules that enumerate only subject-matter nouns, allow 5–10 canonical subareas for broad domains, and keep task/meta language entirely out of the domain channel. Task capsules stay dedicated to AI/LLM data work.
- Profile domain prompts mirror the same subject-only discipline (90–140 words, 10–16 keywords) while the task capsule remains governed by evidence tokens.
- Both jobs and profiles use a light post-filter that strips disallowed logistics/meta tokens from capsule text and keywords, and the OpenAI calls now apply a frequency penalty of `0.6` to discourage repetition.
- See [`docs/capsule-alignment-v3/fixtures.json`](docs/capsule-alignment-v3/fixtures.json) for before/after similarity samples that clear the ≥0.70 SME target in corporate law and frontend web domains.

---


## Domain-agnostic capsules & strict Task Capsule

- The capsule prompt is domain-neutral and works for medicine, software engineering, writing, finance, legal, manufacturing, logistics, education, and more. The model always refers to “the candidate” and keeps personal identifiers out of the summaries.
- The Profile Domain Capsule compresses to subject-matter nouns taken directly from the source material. A post-generation "defluffer" removes roles, verbs, employers, and dates, regenerates a 10-20 token `Keywords:` line, and keeps the capsule under 120 words.
- The Profile Task Capsule is populated exclusively when explicit AI/LLM data-labeling, model-training, or evaluation evidence is supplied. The service uses a deterministic allowlist (NER, bbox, Label Studio, transcription, RLHF/DPO/SFT, guideline QA, safety reviews, etc.) and a validator that blocks generic duties such as analytics, documentation, EHR workflows, meetings, or admin tasks.
- When no qualifying evidence is present, the Task Capsule is automatically replaced with the fixed sentence `No AI/LLM data-labeling, model training, or evaluation experience was provided in the source.` followed by `Keywords: none`.
- To surface valid Task Capsule content, include concrete evidence in the payload (e.g., `"NER on clinical notes"`, `"Bounding boxes in Label Studio"`, `"Prompt writing for SFT"`, `"RLHF pairwise comparisons"`).
- The `/v1/users/upsert` endpoint accepts aliases: `label_experience` is normalized to `labeling_experience`, and `language` (string) is normalized to the `languages` array.
- Job capsules now derive DOMAIN_EVIDENCE and TASK_EVIDENCE directly from job fields, rewrite out soft/logistics language, enforce sentence-only paragraphs, and regenerate `Keywords:` using only evidence tokens.

---


## Keeping your local branches in sync

After merging a pull request, reset your local `main` branch to the latest GitHub state before starting new work. The step-by-step commands live in [`docs/git-workflow.md`](docs/git-workflow.md) and prevent Codex from reintroducing files that already exist on `main`.

- **Quick option:** run `npm run sync:main` (optionally `npm run sync:main -- <feature-branch>`) to fetch from GitHub, reset `main` to `origin/main`, and—when provided—create a fresh feature branch in one command. The script refuses to run with uncommitted changes so you do not lose work by accident.

---


## Environment variables

Copy `.env.example` to `.env` during local development and provide the following variables when deploying. `PINECONE_HOST` is required for serverless projects and is available in the Pinecone console under **Indexes → <your index> → Overview → Endpoint URL**.

| Variable | Required | Description |
| --- | --- | --- |
| `OPENAI_API_KEY` | ✅ | OpenAI key used for chat completions (capsule generation) and embeddings. |
| `PINECONE_API_KEY` | ✅ | Pinecone API key. |
| `PINECONE_INDEX` | ✅ | Pinecone index name (e.g., `freelancers_v2`). Must be cosine, 3072-dim. |
| `PINECONE_HOST` | ✅ | Serverless host URL for the index (e.g., `freelancers_v2-xxxxxx.svc.us-east1-aws.pinecone.io`). |
| `PINECONE_USERS_NAMESPACE` | ➖ | Optional namespace override for user vectors when your index stores multiple collections. |
| `PINECONE_JOBS_NAMESPACE` | ➖ | Optional namespace override for job vectors. |
| `PINECONE_ENV` | ➖ | Legacy controller host fallback. Only use if `PINECONE_HOST` is temporarily unavailable. |
| `SERVICE_API_KEY` | ✅ | Bearer token Bubble must send with every request. |
| `OPENAI_CAPSULE_MODEL` | ➖ | Optional chat model override for capsule generation. Defaults to `gpt-4o-mini` when unset. |

| `LOG_LEVEL` | ➖ | Pino log level (`info` by default). |
| `PORT` | ➖ | HTTP port (`8080` by default). |
| `DATABASE_URL` | ➖ | PostgreSQL connection string for audit logging. Auto-configured by Render's Blueprint. |

> For the optional index creation script you can also set `PINECONE_CLOUD` and `PINECONE_REGION` (default: `aws` / `us-east-1`).

---

## Local development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run the Vitest suite (this automatically performs a TypeScript type-check so Render build issues surface locally):
   ```bash
   npm test
   ```
   > The `pretest` hook runs `npm run typecheck` (a `tsc --noEmit` pass) before executing Vitest. This ensures we catch build time type errors—like the ones Render surfaces—during local development.
3. Build the production bundle:
   ```bash
   npm run build
   ```
4. Local smoke test:
   ```bash
   npm run build
   node dist/server.js
   curl http://localhost:8080/health
   ```
5. (Optional) Generate the Pinecone index from your local machine:
   ```bash
   # Requires PINECONE_API_KEY and PINECONE_INDEX (and optionally PINECONE_CLOUD/PINECONE_REGION)
   npm run index:create
   ```

During local runs the service logs request lifecycle events (start → capsules → embeddings → upsert → complete) with only user IDs and character counts—never raw resume text.

---

## Render deployment guide

1. Fork or clone this repository into your GitHub account.
2. In Render, click **New + → Blueprint** and connect the GitHub repo. Render will detect `render.yaml`.
3. Before clicking **Deploy**, open the service’s **Environment** tab in Render and add values for each required variable: `OPENAI_API_KEY`, `PINECONE_API_KEY`, `PINECONE_INDEX`, `PINECONE_HOST`, `SERVICE_API_KEY`, plus optional overrides such as `OPENAI_CAPSULE_MODEL`, `LOG_LEVEL`, and `PORT` (defaults to `8080`). The Blueprint already defines the keys so you only need to fill in the values. It also pins `NODE_VERSION=20.18.0` and `NPM_CONFIG_PRODUCTION=false` so builds run with a modern Node runtime while still installing dev dependencies (TypeScript). If you create the service manually, set both keys under **Environment** before the first deploy.
4. After the environment variables are saved, trigger the deploy. Render will run `npm ci && npm run build` and start the app with `node dist/server.js` using Node 20.

5. If a deploy starts before the secrets are saved, it will fail fast with an error such as `Environment variable OPENAI_API_KEY is required`. Simply add the missing values and click **Manual Deploy → Clear cache & deploy** to retry.
6. After a successful deploy, verify the health check:
   ```bash
   curl https://<your-render-service>.onrender.com/health
   ```
7. Test the upsert endpoint:

   ```bash
   curl -X POST "https://<your-render-service>.onrender.com/v1/users/upsert" \
     -H "Authorization: Bearer $SERVICE_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "user_id":"u_demo",
       "resume_text":"Board-certified obstetrician-gynecologist ...",
       "work_experience":["OB Hospitalist ...", "Residency in OB-GYN ..."],
       "education":["MD ..."],
       "labeling_experience":["NER on clinical notes"],
       "country":"US",
       "languages":["English"]
     }'
   ```

Render's logs will show the lifecycle events and you should receive `status: "ok"` along with the capsule texts and vector IDs.

---

## Database and migrations (Render)

The service uses a PostgreSQL database (provisioned automatically by Render's Blueprint) for audit logging. The database stores records of all job/user upserts and match requests for debugging and analytics.

**Migrations run automatically on every deploy.** The `render.yaml` configures the start command as:
```
npx prisma migrate deploy && node dist/server.js
```

This means:
- When you merge a PR that includes schema changes, just deploy (or let Render auto-deploy)
- Prisma will automatically apply any pending migrations before the server starts
- No manual migration commands are needed on Render

**If a deploy fails due to migration issues:**
1. Check Render logs for the specific error
2. Ensure the `DATABASE_URL` environment variable is correctly set (should be auto-configured by the Blueprint)
3. If needed, you can run migrations manually from Render's Shell tab: `npx prisma migrate deploy`

---

## Pinecone index setup

1. Sign in to the Pinecone console and open the **Indexes** tab.
2. Create an index with:
   - **Name:** `freelancers_v2` (or your preferred name).
   - **Dimension:** `3072`.
   - **Metric:** `cosine`.
   - **Pods/Serverless:** Serverless (recommended).
3. Once created, copy the **Endpoint URL** from the index **Overview** page and set it as `PINECONE_HOST` in your environment.
4. (Optional) To automate index creation from your terminal, set `PINECONE_API_KEY` and `PINECONE_INDEX` locally and run (requires Pinecone permissions that allow index creation):
   ```bash
   npm run index:create
   ```
   Use `PINECONE_CLOUD` and `PINECONE_REGION` if you need to override the defaults. The script prints the host URL you should place in `PINECONE_HOST`.
5. After calling the service, verify that two vectors exist in the Pinecone console under **Vectors** with IDs `usr_<userId>::domain` and `usr_<userId>::task`.

---

## OpenAI configuration

- Set `OPENAI_API_KEY` in Render’s environment settings (or `.env` locally).
- (Optional) Set `OPENAI_CAPSULE_MODEL` if you want the service to use a specific chat model for capsule generation (for example, `gpt-4o`). When unset, the service defaults to `gpt-4o-mini` and logs a warning on first use.

- The service calls OpenAI Chat once per request (temperature `0.2`) and the embeddings API twice using `text-embedding-3-large` (dimension `3072`). Ensure your OpenAI account has quota for both.

---

## API usage

### Authentication

All requests must include:
```
Authorization: Bearer <SERVICE_API_KEY>
Content-Type: application/json
```

### `GET /health`

Returns `{ "status": "ok" }`.

```bash
curl "$SERVICE_URL/health"
```

### `POST /v1/users/upsert`

Generates the domain and task capsules, embeds each, upserts them to Pinecone, and returns capsule texts plus vector IDs.

```bash
curl -X POST "$SERVICE_URL/v1/users/upsert" \
  -H "Authorization: Bearer $SERVICE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id":"u_demo",
    "resume_text":"Board-certified obstetrician-gynecologist ...",
    "work_experience":["OB Hospitalist ...", "Residency in OB-GYN ..."],
    "education":["MD ..."],
    "labeling_experience":["NER on clinical notes"],
    "country":"US",
    "languages":["English"]
  }'
```

Successful responses include `embedding_model: "text-embedding-3-large"`, `dimension: 3072`, capsule texts, character counts, and ISO timestamp. Raw embedding vectors are never returned.

### `POST /v1/jobs/upsert`

Generates the Job Domain and Job Task capsules from structured job details, embeds each with `text-embedding-3-large`, and upserts `job_<jobId>::domain` / `job_<jobId>::task` into Pinecone.

```bash
curl -X POST "$SERVICE_URL/v1/jobs/upsert" \
  -H "Authorization: Bearer $SERVICE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "job_id":"j_obgyn",
    "title":"OBGYN Doctors - LLM Training",
    "fields":{
      "Instructions":"Review obstetrics and gynecology question-answer data for accuracy.",
      "Dataset_Description":"Prompt-response transcripts and rubric scores for obstetrics scenarios.",
      "Data_SubjectMatter":"OBGYN medicine, maternal-fetal medicine, gynecologic oncology",
      "LabelTypes":["evaluation","prompt+response"],
      "Requirements_Additional":"Board-certified OB-GYN with 5+ years clinical experience"
    }
  }'
```

The response mirrors the user endpoint (`status: "ok"`, capsule texts, vector IDs, character counts, and `updated_at`). Reposting with the same `job_id` overwrites both vectors.

### `POST /v1/match/score_users_for_job`

Scores a provided list of applicants against a job using two Pinecone queries (domain and task channels). The service normalizes `w_domain`/`w_task`, blends similarities, and returns every requested user sorted by the final score.

**Request fields**

| Field | Type | Description |
| --- | --- | --- |
| `job_id` | string | Job identifier (matches the ID used during `/v1/jobs/upsert`). |
| `candidate_user_ids` | string[] | Required list of applicant IDs to score (1-50k). |
| `w_domain` | number | Optional weight for the domain channel (default `1.0`). |
| `w_task` | number | Optional weight for the task channel (default `0.0`). |
| `topK` | number | Optional Pinecone `topK` override. Defaults to the candidate count (server-capped at 10k). |
| `threshold` | number | Optional cutoff for Bubble’s UI. The response includes `count_gte_threshold` when supplied. |

**Response highlights**

- Each user entry includes `s_domain`, `s_task`, `final`, and a deterministic `rank`.
- Missing vectors are surfaced under `missing_vectors.domain` / `.task` so Bubble can re-upsert as needed.
- `w_domain`/`w_task` reflect normalized weights; scores are rounded to 6 decimal places.

```bash
curl -X POST "$SERVICE_URL/v1/match/score_users_for_job" \
  -H "Authorization: Bearer $SERVICE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "job_id":"1733994253353x683525100278382600",
    "candidate_user_ids":["u_101","u_102","u_103","u_104"],
    "w_domain":1.0,
    "w_task":0.0,
    "threshold":0.82
  }'
```

The response returns sorted scores plus `count_gte_threshold` when a threshold is provided. Skip the task weight (set `w_task` to `0`) for domain-only screening scenarios like medical specialist checks.

---

## Postman collection

A minimal collection is available at [`postman/collection.json`](postman/collection.json) with `/health` and `/v1/users/upsert` requests preconfigured for quick smoke testing.

---

## Bubble integration

1. Base URL: your Render service URL (e.g., `https://capsules.onrender.com`).
2. Shared header: `Authorization: Bearer ${SERVICE_API_KEY}`.
3. Endpoint: `POST /v1/users/upsert`.
4. Payload fields:
   - `user_id` = Current User’s unique ID.
   - `resume_text` = Current User’s resume text (full text is accepted; no server-side character limit).

   - Optional arrays (`work_experience`, `education`, `labeling_experience`, `languages`) formatted as text lists.
   - `country` as a plain string.
5. Store the following response fields in Bubble:
   - `domain.capsule_text` → **Profile Domain Capsule** (text)
   - `task.capsule_text` → **Profile Task Capsule** (text)
   - `updated_at` → **Capsules Last Modified** (date)

### Manual job workflow in Bubble

1. Add a Bubble action that calls `POST /v1/jobs/upsert` with the job metadata (title, instructions, subject matter, label types, etc.).
2. Persist the returned `domain.capsule_text`, `task.capsule_text`, and `updated_at` as **Job Domain Capsule**, **Job Task Capsule**, and **Job Capsules Last Modified** for audit history.
3. When vetting applicants for a job, call `POST /v1/match/score_users_for_job` with the `job_id`, shortlisted `candidate_user_ids`, and manual weights (`w_domain`, `w_task`). Display the sorted scores (and optional threshold counts) to recruiters inside Bubble.

> Do **not** store Pinecone vectors in Bubble—the service writes them directly to Pinecone.

See [`docs/bubble-and-deployment.md`](docs/bubble-and-deployment.md) for the exact Bubble field names and the live Render service reference.


---

## Acceptance checklist

- [ ] Pinecone index created with metric **cosine** and dimension **3072**; host copied to `PINECONE_HOST`.
- [ ] Render environment configured with `OPENAI_API_KEY`, `PINECONE_API_KEY`, `PINECONE_INDEX`, `PINECONE_HOST`, `SERVICE_API_KEY`, and optional `LOG_LEVEL`/`PORT`.
- [ ] Render deployment succeeds via `render.yaml`; `/health` returns `{"status":"ok"}`.
- [ ] `POST /v1/users/upsert` returns `status: "ok"`, capsule texts, and vector IDs.
- [ ] `POST /v1/jobs/upsert` returns `status: "ok"`, job capsule texts, and vector IDs (`job_<id>::domain|task`).
- [ ] `POST /v1/match/score_users_for_job` returns sorted scores for the provided candidate list.
- [ ] Pinecone console shows both vectors per user: `usr_<userId>::domain` and `usr_<userId>::task`.
- [ ] Bubble stores capsule texts and timestamps only.

---

Need help? Review logs in Render or run the Postman collection for end-to-end verification.
