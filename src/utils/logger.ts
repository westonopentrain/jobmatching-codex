import pino, { LoggerOptions } from 'pino';
import { getEnv } from './env';

const level = getEnv('LOG_LEVEL') ?? 'info';

export const loggerOptions: LoggerOptions = {
  level,
  base: null as null,
  redact: {
    paths: ['req.headers.authorization'],
    censor: '***',
  },
};

export const logger = pino(loggerOptions);

export type Logger = typeof logger;
