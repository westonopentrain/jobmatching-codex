import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { AppError, toErrorResponse } from '../utils/errors';
import { ensureAuthorized } from '../utils/auth';
import { requireEnv } from '../utils/env';
import { EMBEDDING_DIMENSION, EMBEDDING_MODEL, embedText } from '../services/embeddings';
import { upsertVector, deleteVectors } from '../services/pinecone';
import { getDb, isDatabaseAvailable } from '../services/db';
import { generateJobCapsules, normalizeJobRequest } from '../services/job-capsules';
import { JobFields, UpsertJobRequest } from '../utils/types';
import { classifyJobSync } from '../services/job-classifier';
import { auditJobUpsert } from '../services/audit';
import { checkJobUpsertAlerts } from '../services/alerts';

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

      // Classify job to determine specialized vs generic and extract requirements
      const classification = classifyJobSync(normalized);
      log.info(
        {
          event: 'job.classified',
          jobId: normalized.jobId,
          jobClass: classification.jobClass,
          confidence: classification.confidence,
          credentials: classification.requirements.credentials,
          expertiseTier: classification.requirements.expertiseTier,
        },
        'Job classified for smart matching'
      );

      const domainVectorId = `job_${normalized.jobId}::domain`;
      const taskVectorId = `job_${normalized.jobId}::task`;

      const [domainEmbedding, taskEmbedding] = await Promise.all([
        embedText(capsules.domain.text),
        embedText(capsules.task.text),
      ]);

      // Build enriched metadata for Pinecone filtering
      // This enables smart matching: specialized jobs filter by credentials,
      // generic jobs exclude overqualified domain experts
      const jobMetadata = {
        job_id: normalized.jobId,
        model: EMBEDDING_MODEL,
        type: 'job' as const,
        job_class: classification.jobClass,
        required_credentials: classification.requirements.credentials,
        subject_matter_codes: classification.requirements.subjectMatterCodes,
        required_experience_years: classification.requirements.minimumExperienceYears,
        expertise_tier: classification.requirements.expertiseTier,
        countries: classification.requirements.countries,
        languages: classification.requirements.languages,
      };

      await upsertVector(domainVectorId, domainEmbedding, {
        ...jobMetadata,
        section: 'domain' as const,
      });

      await upsertVector(taskVectorId, taskEmbedding, {
        ...jobMetadata,
        section: 'task' as const,
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
      const elapsedRounded = Number(elapsedMs.toFixed(2));

      // Audit logging (non-blocking)
      auditJobUpsert({
        jobId: normalized.jobId,
        requestId,
        title: normalized.title,
        rawInput: normalized as unknown as Record<string, unknown>,
        domainCapsule: capsules.domain.text,
        domainKeywords: capsules.domain.keywords ?? [],
        taskCapsule: capsules.task.text,
        taskKeywords: capsules.task.keywords ?? [],
        classification,
        elapsedMs: elapsedRounded,
      });

      // Check for alerts (non-blocking)
      checkJobUpsertAlerts({
        jobId: normalized.jobId,
        jobTitle: normalized.title,
        jobClass: classification.jobClass,
        classificationConfidence: classification.confidence,
      });

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
        // Classification determines matching behavior:
        // - specialized: filter candidates by credentials/domain, use domain-heavy weights
        // - generic: exclude overqualified domain experts, use task-heavy weights
        classification: {
          job_class: classification.jobClass,
          confidence: classification.confidence,
          requirements: classification.requirements,
          reasoning: classification.reasoning,
        },
        updated_at: now,
        elapsed_ms: elapsedRounded,
      });
    } catch (error) {
      const errorElapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const errorElapsedRounded = Number(errorElapsedMs.toFixed(2));
      if (error instanceof AppError) {
        request.log.warn(
          { error: error.message, code: error.code, details: error.details, event: 'jobs.upsert.error', elapsedMs: errorElapsedRounded },
          'Handled job upsert error'
        );
        return reply.status(error.statusCode).send(toErrorResponse(error));
      }

      request.log.error({ err: error, event: 'jobs.upsert.error', elapsedMs: errorElapsedRounded }, 'Unexpected error during job upsert');
      const appError = new AppError({
        code: 'JOB_UPSERT_FAILURE',
        statusCode: 500,
        message: 'Unexpected server error',
      });
      return reply.status(appError.statusCode).send(toErrorResponse(appError));
    }
  });

  // DELETE endpoint for removing jobs
  fastify.delete('/v1/jobs/:jobId', async (request, reply) => {
    const log = request.log.child({ route: 'jobs.delete' });

    try {
      ensureAuthorized(request.headers.authorization, serviceApiKey);

      const { jobId } = request.params as { jobId: string };
      if (!jobId || typeof jobId !== 'string') {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          statusCode: 400,
          message: 'Job ID is required',
        });
      }

      log.info({ event: 'jobs.delete.start', jobId }, 'Starting job deletion');

      // Delete vectors from Pinecone
      const domainVectorId = `job_${jobId}::domain`;
      const taskVectorId = `job_${jobId}::task`;
      await deleteVectors([domainVectorId, taskVectorId]);
      log.info({ event: 'jobs.delete.pinecone', jobId }, 'Deleted job vectors from Pinecone');

      // Delete audit records from PostgreSQL
      let auditDeleted = 0;
      if (isDatabaseAvailable()) {
        const db = getDb();
        if (db) {
          const result = await db.auditJobUpsert.deleteMany({
            where: { jobId },
          });
          auditDeleted = result.count;
          log.info({ event: 'jobs.delete.audit', jobId, count: auditDeleted }, 'Deleted job audit records');
        }
      }

      return reply.status(200).send({
        status: 'ok',
        job_id: jobId,
        deleted: {
          vectors: [domainVectorId, taskVectorId],
          audit_records: auditDeleted,
        },
      });
    } catch (error) {
      if (error instanceof AppError) {
        log.warn({ error: error.message, code: error.code }, 'Handled job delete error');
        return reply.status(error.statusCode).send(toErrorResponse(error));
      }

      log.error({ err: error }, 'Unexpected error during job delete');
      const appError = new AppError({
        code: 'JOB_DELETE_FAILURE',
        statusCode: 500,
        message: 'Unexpected server error',
      });
      return reply.status(appError.statusCode).send(toErrorResponse(appError));
    }
  });
};
