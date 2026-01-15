/**
 * Database client singleton for Prisma
 *
 * Uses lazy initialization to avoid connection errors when DATABASE_URL is not set
 * (e.g., in local development without a database).
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

let prismaClient: PrismaClient | null = null;
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
      prismaClient = new PrismaClient({
        datasources: {
          db: {
            url: databaseUrl,
          },
        },
      });

      logger.info({ event: 'db.init', url: databaseUrl.replace(/:[^:@]+@/, ':***@') }, 'Database client initialized');
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
}
