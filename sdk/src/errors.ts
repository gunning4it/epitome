export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  reset?: number;
  retryAfter?: number;
}

export interface EpitomeErrorContext {
  status: number;
  code: string;
  details?: unknown;
  headers?: Record<string, string>;
  rateLimit?: RateLimitInfo;
}

export class EpitomeError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly headers: Record<string, string>;
  readonly rateLimit?: RateLimitInfo;

  constructor(message: string, context: EpitomeErrorContext) {
    super(message);
    this.name = 'EpitomeError';
    this.status = context.status;
    this.code = context.code;
    this.details = context.details;
    this.headers = context.headers ?? {};
    this.rateLimit = context.rateLimit;
  }
}

export class EpitomeAuthError extends EpitomeError {
  constructor(message: string, context: EpitomeErrorContext) {
    super(message, context);
    this.name = 'EpitomeAuthError';
  }
}

export class EpitomeConsentError extends EpitomeError {
  constructor(message: string, context: EpitomeErrorContext) {
    super(message, context);
    this.name = 'EpitomeConsentError';
  }
}

export class EpitomeRateLimitError extends EpitomeError {
  constructor(message: string, context: EpitomeErrorContext) {
    super(message, context);
    this.name = 'EpitomeRateLimitError';
  }
}

export class EpitomeValidationError extends EpitomeError {
  constructor(message: string, context: EpitomeErrorContext) {
    super(message, context);
    this.name = 'EpitomeValidationError';
  }
}

export class EpitomeServerError extends EpitomeError {
  constructor(message: string, context: EpitomeErrorContext) {
    super(message, context);
    this.name = 'EpitomeServerError';
  }
}

export function createEpitomeError(
  message: string,
  context: EpitomeErrorContext,
): EpitomeError {
  if (context.status === 401) {
    return new EpitomeAuthError(message, context);
  }

  if (context.status === 403 || context.code === 'CONSENT_DENIED') {
    return new EpitomeConsentError(message, context);
  }

  if (context.status === 429 || context.code === 'RATE_LIMIT_EXCEEDED') {
    return new EpitomeRateLimitError(message, context);
  }

  if (context.status === 400 || context.status === 422) {
    return new EpitomeValidationError(message, context);
  }

  if (context.status >= 500) {
    return new EpitomeServerError(message, context);
  }

  return new EpitomeError(message, context);
}
