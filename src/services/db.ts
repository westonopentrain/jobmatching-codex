/**
 * Database client singleton for Prisma
 *
 * Uses lazy initialization to avoid connection errors when DATABASE_URL is not set
 * (e.g., in local development without a database).
 *
 * Prisma 7 requires using an adapter for direct database connections.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { logger } from '../utils/logger';

let prismaClient: PrismaClient | null = null;
let pool: Pool | null = null;
let connectionAttempted = false;
let connectionFailed = false;

/**
 * Get the Prisma client instance.
 * Returns null if DATABASE_URL is not configured or connection failed.
 */
export function getDb(): PrismaClient | null {
  if (connectionFailed) {
    return null;
  }

  if (!prismaClient && !connectionAttempted) {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      logger.warn({ event: 'db.skip' }, 'DATABASE_URL not configured, audit logging disabled');
      connectionFailed = true;
      return null;
    }

    connectionAttempted = true;

    try {
      logger.info(
        { event: 'db.init.attempt', url: databaseUrl.replace(/:[^:@]+@/, ':***@') },
        'Attempting to initialize database client'
      );

      // Create pg Pool
      pool = new Pool({ connectionString: databaseUrl });

      // Create Prisma adapter
      const adapter = new PrismaPg(pool);

      // Create PrismaClient with adapter
      prismaClient = new PrismaClient({ adapter });

      logger.info({ event: 'db.init' }, 'Database client initialized');
    } catch (error) {
      logger.error({ event: 'db.init.error', error }, 'Failed to initialize database client');
      connectionFailed = true;
      return null;
    }
  }

  return prismaClient;
}

/**
 * Check if the database is available and configured
 */
export function isDatabaseAvailable(): boolean {
  return getDb() !== null;
}

/**
 * Disconnect the database client (for graceful shutdown)
 */
export async function disconnectDb(): Promise<void> {
  if (prismaClient) {
    await prismaClient.$disconnect();
    prismaClient = null;
    connectionAttempted = false;
    logger.info({ event: 'db.disconnect' }, 'Database client disconnected');
  }
  if (pool) {
    await pool.end();
    pool = null;
  }
}
