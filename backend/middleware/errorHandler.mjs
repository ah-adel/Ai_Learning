import logger from '../services/logger.mjs';

export class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export const notFoundHandler = (req, res, next) => {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404, {
    method: req.method,
    url: req.originalUrl,
  }));
};

export default function errorHandler(error, req, res, next) {
  const statusCode = error?.statusCode || error?.status || 500;
  const isServerError = statusCode >= 500;

  if (isServerError) {
    logger.error('Unhandled application error', {
      method: req.method,
      url: req.originalUrl,
      statusCode,
      message: error?.message,
      stack: error?.stack,
    });
  } else {
    logger.warn('Request validation error', {
      method: req.method,
      url: req.originalUrl,
      statusCode,
      message: error?.message,
      details: error?.details,
    });
  }

  const payload = {
    success: false,
    error: error?.message || 'An unexpected server error occurred.',
    details: error?.details ?? null,
  };

  if (process.env.NODE_ENV === 'production' && isServerError) {
    payload.details = null;
  }

  res.status(statusCode).json(payload);
}
