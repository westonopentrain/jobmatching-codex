import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { AppError, toErrorResponse } from '../utils/errors';
import { ensureAuthorized } from '../utils/auth';
import { requireEnv } from '../utils/env';
import { EMBEDDING_DIMENSION, EMBEDDING_MODEL, embedText } from '../services/embeddings';
import { upsertVector } from '../services/pinecone';
import { generateJobCapsules, normalizeJobRequest } from '../services/job-capsules';
import { JobFields, UpsertJobRequest } from '../utils/types';

const fieldSchema = z.object({
  Instructions: z.string().optional(),
  Workload_Desc: z.string().optional(),
  Dataset_Description: z.string().optional(),
  Data_SubjectMatter: z.string().optional(),
  Data_Type: z.string().optional(),
  LabelTypes: z.array(z.string()).optional(),
  Requirements_Additional: z.string().optional(),
  AvailableLanguages: z.array(z.string()).optional(),
  AvailableCountries: z.array(z.string()).optional(),
  ExpertiseLevel: z.string().optional(),
  TimeRequirement: z.string().optional(),
  ProjectType: z.string().optional(),
  LabelSoftware: z.string().optional(),
  AdditionalSkills: z.array(z.string()).optional(),
});

const jobUpsertSchema = z.object({
  job_id: z.string().min(1),
  title: z.string().optional(),
  fields: fieldSchema,
});

export const jobRoutes: FastifyPluginAsync = async (fastify) => {
  const serviceApiKey = requireEnv('SERVICE_API_KEY');

  fastify.post('/v1/jobs/upsert', async (request, reply) => {
    const requestId = request.id as string;
    const log = request.log.child({ route: 'jobs.upsert', requestId });
    const startedAt = process.hrtime.bigint();

    try {
      ensureAuthorized(request.headers.authorization, serviceApiKey);

      const parsed = jobUpsertSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          statusCode: 400,
          message: 'Invalid request body',
          details: { issues: parsed.error.issues },
        });
      }

      const rawFields = parsed.data.fields;
      const fieldEntries = Object.entries(rawFields).filter(([, value]) => value !== undefined) as Array<[
        keyof JobFields,
        JobFields[keyof JobFields],
      ]>;
      const fields = Object.fromEntries(fieldEntries) as JobFields;

      const upsertRequest: UpsertJobRequest = {
        job_id: parsed.data.job_id,
        fields,
      };

      if (parsed.data.title !== undefined) {
        upsertRequest.title = parsed.data.title;
      }

      const normalized = normalizeJobRequest(upsertRequest);

      const capsules = await generateJobCapsules(normalized);
      log.info(
        {
          event: 'job_capsules.generated',
          jobId: normalized.jobId,
          domainChars: capsules.domain.text.length,
          taskChars: capsules.task.text.length,
        },
        'Job capsules generated successfully'
      );

      const domainVectorId = `job_${normalized.jobId}::domain`;
      const taskVectorId = `job_${normalized.jobId}::task`;

      const [domainEmbedding, taskEmbedding] = await Promise.all([
        embedText(capsules.domain.text),
        embedText(capsules.task.text),
      ]);

      await upsertVector(domainVectorId, domainEmbedding, {
        job_id: normalized.jobId,
        section: 'domain',
        model: EMBEDDING_MODEL,
      });

      await upsertVector(taskVectorId, taskEmbedding, {
        job_id: normalized.jobId,
        section: 'task',
        model: EMBEDDING_MODEL,
      });

      log.info(
        {
          event: 'job_pinecone.upsert',
          jobId: normalized.jobId,
          domainVectorId,
          taskVectorId,
        },
        'Upserted job vectors to Pinecone'
      );

      const now = new Date().toISOString();
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

      return reply.status(200).send({
        status: 'ok',
        job_id: normalized.jobId,
        embedding_model: EMBEDDING_MODEL,
        dimension: EMBEDDING_DIMENSION,
        domain: {
          vector_id: domainVectorId,
          capsule_text: capsules.domain.text,
          chars: capsules.domain.text.length,
          keywords: capsules.domain.keywords ?? [],
        },
        task: {
          vector_id: taskVectorId,
          capsule_text: capsules.task.text,
          chars: capsules.task.text.length,
          keywords: capsules.task.keywords ?? [],
        },
        updated_at: now,
        elapsed_ms: Number(elapsedMs.toFixed(2)),
      });
    } catch (error) {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const elapsedRounded = Number(elapsedMs.toFixed(2));
      if (error instanceof AppError) {
        request.log.warn(
          { error: error.message, code: error.code, details: error.details, event: 'jobs.upsert.error', elapsedMs: elapsedRounded },
          'Handled job upsert error'
        );
        return reply.status(error.statusCode).send(toErrorResponse(error));
      }

      request.log.error({ err: error, event: 'jobs.upsert.error', elapsedMs: elapsedRounded }, 'Unexpected error during job upsert');
      const appError = new AppError({
        code: 'JOB_UPSERT_FAILURE',
        statusCode: 500,
        message: 'Unexpected server error',
      });
      return reply.status(appError.statusCode).send(toErrorResponse(appError));
    }
  });
};
