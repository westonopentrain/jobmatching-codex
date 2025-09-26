# User Capsule Upsert Service

This Fastify service receives Bubble user profile data, generates domain and task capsules with OpenAI, embeds each capsule with `text-embedding-3-large`, and upserts both vectors into Pinecone. Bubble receives only the capsule texts, vector identifiers, and metadata required to display and audit updates.

---

## Environment variables

Copy `.env.example` to `.env` during local development and provide the following variables when deploying. `PINECONE_HOST` is required for serverless projects and is available in the Pinecone console under **Indexes → <your index> → Overview → Endpoint URL**.

| Variable | Required | Description |
| --- | --- | --- |
| `OPENAI_API_KEY` | ✅ | OpenAI key used for chat completions (capsule generation) and embeddings. |
| `PINECONE_API_KEY` | ✅ | Pinecone API key. |
| `PINECONE_INDEX` | ✅ | Pinecone index name (e.g., `freelancers_v2`). Must be cosine, 3072-dim. |
| `PINECONE_HOST` | ✅ | Serverless host URL for the index (e.g., `freelancers_v2-xxxxxx.svc.us-east1-aws.pinecone.io`). |
| `PINECONE_ENV` | ➖ | Legacy controller host fallback. Only use if `PINECONE_HOST` is temporarily unavailable. |
| `SERVICE_API_KEY` | ✅ | Bearer token Bubble must send with every request. |
| `OPENAI_CAPSULE_MODEL` | ➖ | Optional override for the chat model (defaults to `gpt-4o-mini`). |
| `LOG_LEVEL` | ➖ | Pino log level (`info` by default). |
| `PORT` | ➖ | HTTP port (`8080` by default). |

> For the optional index creation script you can also set `PINECONE_CLOUD` and `PINECONE_REGION` (default: `aws` / `us-east-1`).

---

## Local development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run the Vitest suite:
   ```bash
   npm test
   ```
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
codex/implement-user-capsule-upsert-service-e29ilo

3. Before clicking **Deploy**, open the service’s **Environment** tab in Render and add values for each required variable: `OPENAI_API_KEY`, `PINECONE_API_KEY`, `PINECONE_INDEX`, `PINECONE_HOST`, `SERVICE_API_KEY`, plus optional `LOG_LEVEL` and `PORT` (defaults to `8080`). The Blueprint already defines the keys so you only need to fill in the values.
4. After the environment variables are saved, trigger the deploy. Render will run `npm ci && npm run build` and start the app with `node dist/server.js`.
5. If a deploy starts before the secrets are saved, it will fail fast with an error such as `Environment variable OPENAI_API_KEY is required`. Simply add the missing values and click **Manual Deploy → Clear cache & deploy** to retry.
6. After a successful deploy, verify the health check:
   ```bash
   curl https://<your-render-service>.onrender.com/health
   ```
7. Test the upsert endpoint:
codex/implement-user-capsule-upsert-service-e29ilo

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

Render’s logs will show the lifecycle events and you should receive `status: "ok"` along with the capsule texts and vector IDs.

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
codex/implement-user-capsule-upsert-service-e29ilo
   - `resume_text` = Current User’s resume text (full text is accepted; no server-side character limit).

   - Optional arrays (`work_experience`, `education`, `labeling_experience`, `languages`) formatted as text lists.
   - `country` as a plain string.
5. Store the following response fields in Bubble:
   - `domain.capsule_text` → **Profile Domain Capsule** (text)
   - `task.capsule_text` → **Profile Task Capsule** (text)
   - `updated_at` → **Capsules Last Modified** (date)

> Do **not** store Pinecone vectors in Bubble—the service writes them directly to Pinecone.

codex/implement-user-capsule-upsert-service-e29ilo
See [`docs/bubble-and-deployment.md`](docs/bubble-and-deployment.md) for the exact Bubble field names and the live Render service reference.


---

## Acceptance checklist

- [ ] Pinecone index created with metric **cosine** and dimension **3072**; host copied to `PINECONE_HOST`.
- [ ] Render environment configured with `OPENAI_API_KEY`, `PINECONE_API_KEY`, `PINECONE_INDEX`, `PINECONE_HOST`, `SERVICE_API_KEY`, and optional `LOG_LEVEL`/`PORT`.
- [ ] Render deployment succeeds via `render.yaml`; `/health` returns `{"status":"ok"}`.
- [ ] `POST /v1/users/upsert` returns `status: "ok"`, capsule texts, and vector IDs.
- [ ] Pinecone console shows both vectors per user: `usr_<userId>::domain` and `usr_<userId>::task`.
- [ ] Bubble stores capsule texts and timestamps only.

---

Need help? Review logs in Render or run the Postman collection for end-to-end verification.
