import { AppError } from './errors';

export function ensureAuthorized(authorization: string | undefined, serviceKey: string): void {
  if (!authorization || !authorization.startsWith('Bearer ')) {
    throw new AppError({
      code: 'UNAUTHORIZED',
      statusCode: 401,
      message: 'Missing bearer token',
    });
  }

  const token = authorization.slice('Bearer '.length).trim();
  if (token !== serviceKey) {
    throw new AppError({
      code: 'UNAUTHORIZED',
      statusCode: 401,
      message: 'Invalid bearer token',
    });
  }
}
