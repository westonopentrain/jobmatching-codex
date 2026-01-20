import { getEnv } from '../utils/env';
import { logger } from '../utils/logger';

const DEFAULT_CAPSULE_MODEL = 'gpt-4.1';
let capsuleModelWarningLogged = false;

export function resolveCapsuleModel(): string {
  const override = getEnv('OPENAI_CAPSULE_MODEL');
  if (override) {
    return override;
  }

  if (!capsuleModelWarningLogged) {
    logger.warn(
      {
        defaultModel: DEFAULT_CAPSULE_MODEL,
      },
      'OPENAI_CAPSULE_MODEL is not set; falling back to default model'
    );
    capsuleModelWarningLogged = true;
  }

  return DEFAULT_CAPSULE_MODEL;
}

