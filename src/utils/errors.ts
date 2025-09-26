export type ErrorCode =
  | 'LLM_FAILURE'
  | 'EMBEDDING_FAILURE'
  | 'UPSERT_FAILURE'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED';

export interface ErrorDetails {
  hint?: string;
  [key: string]: unknown;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: ErrorDetails;

  constructor(options: {
    message: string;
    code: ErrorCode;
    statusCode: number;
    details?: ErrorDetails;
  }) {
    super(options.message);
    this.code = options.code;
    this.statusCode = options.statusCode;
    if (options.details !== undefined) {
      this.details = options.details;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface ErrorResponseBody {
  status: 'error';
  code: ErrorCode;
  message: string;
  details?: ErrorDetails;
}

export function toErrorResponse(error: AppError): ErrorResponseBody {
  return {
    status: 'error',
    code: error.code,
    message: error.message,
    ...(error.details ? { details: error.details } : {}),
  };
}
