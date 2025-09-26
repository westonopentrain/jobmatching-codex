# Bubble Data Model & Render Deployment Notes

## Bubble User fields

The Bubble application stores capsule metadata on the **User** data type using the following fields:

| Field name            | Type | Description |
| --------------------- | ---- | ----------- |
| `capsule.domain.text` | text | Stores the Domain capsule text returned from the upsert service. |
| `capsule.task.text`   | text | Stores the Task capsule text returned from the upsert service. |
| `capsule.updated.at`  | date | Timestamp saved from the `updated_at` value in the API response. |

Each time Bubble calls `POST /v1/users/upsert`, update these fields with the values returned in the response body. Do **not** persist embedding vectors in Bubble—vectors remain in Pinecone.

## Render service reference

| Property | Value |
| -------- | ----- |
| Service URL | `https://user-capsule-upsert-service.onrender.com` |
| Service ID  | `srv-d3b0vpffte5s739citc0` |

Use the URL as the base endpoint for Bubble, Postman, or curl smoke tests. The Service ID is helpful when opening Render support tickets or when using the Render CLI.
