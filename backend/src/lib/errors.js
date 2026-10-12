export class AppError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} code machine-readable code the frontend can switch on
   * @param {string} message user-facing message (plain language)
   * @param {object} [details] e.g. { fields: {name: msg} }
   */
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new AppError(400, 'BAD_REQUEST', message, details);
export const validationFailed = (fields, message = 'Some fields need attention.', extra = {}) =>
  new AppError(422, 'VALIDATION_FAILED', message, { fields, ...extra });
export const unauthorized = (message = 'Sign in to continue.') => new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have permission to do this.') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found.') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message, code = 'CONFLICT') => new AppError(409, code, message);

/** Map a workflow checkAction() failure to an HTTP error. */
export function fromWorkflow(res) {
  if (res.code === 'FORBIDDEN') return forbidden(res.message);
  if (res.code === 'NOT_YET') return conflict(res.message, 'NOT_YET');
  if (res.code === 'INVALID_STATE') return conflict(`${res.message} Reload the page to see the latest status.`, 'INVALID_STATE');
  return badRequest(res.message);
}

/** Wrap async Express 4 handlers so rejections reach the error handler. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
