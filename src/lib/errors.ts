/** Typed application errors mapped to HTTP responses without leaking internals. */

export class AppError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(message: string, status = 400, code = 'bad_request', details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'unauthenticated');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action', details?: unknown) {
    super(message, 403, 'forbidden', details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'not_found');
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, 'conflict', details);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, 'validation_error', details);
  }
}

export class ScopeViolationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 403, 'scope_violation', details);
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded') {
    super(message, 429, 'rate_limited');
  }
}

export class KillSwitchError extends AppError {
  constructor(message = 'Assessment execution is halted by the kill switch') {
    super(message, 423, 'kill_switch');
  }
}

export function toPublicError(error: unknown): { status: number; body: { error: string; code: string; details?: unknown } } {
  if (error instanceof AppError) {
    return { status: error.status, body: { error: error.message, code: error.code, details: error.details } };
  }
  const maybe = error as { status?: number; code?: string; message?: string };
  if (maybe?.status && maybe?.code) {
    return { status: maybe.status, body: { error: maybe.message ?? 'Request failed', code: maybe.code } };
  }
  // A malformed identifier reaching the database raises a cast error (SQLSTATE
  // 22P02). That can only mean the record does not exist, so answer 404 rather
  // than reporting an internal fault and logging a spurious server error.
  if (maybe?.code === '22P02') {
    return { status: 404, body: { error: 'The requested record could not be found.', code: 'not_found' } };
  }
  // Never expose stack traces or SQL to the browser.
  return { status: 500, body: { error: 'An unexpected error occurred. The event has been logged.', code: 'internal_error' } };
}

export function message(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
