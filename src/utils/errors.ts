export type ErrorCode =
  | 'LLM_FAILURE'
  | 'EMBEDDING_FAILURE'
  | 'UPSERT_FAILURE'
  | 'JOB_UPSERT_FAILURE'
  | 'JOB_DELETE_FAILURE'
  | 'JOB_NOTIFY_FAILURE'
  | 'JOB_METADATA_FAILURE'
  | 'USER_DELETE_FAILURE'
  | 'USER_METADATA_FAILURE'
  | 'VALIDATION_ERROR'
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'MISSING_VECTOR'
  | 'JOB_VECTORS_MISSING'
  | 'USER_VECTORS_MISSING'
  | 'UNPROCESSABLE_WEIGHTS'
  | 'MATCH_FAILURE'
  | 'PINECONE_FETCH_FAILURE'
  | 'PINECONE_QUERY_FAILURE'
  | 'PINECONE_DELETE_FAILURE'
  | 'PINECONE_UPDATE_FAILURE'
  | 'PINECONE_FAILURE'
  | 'RATE_LIMIT';

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
