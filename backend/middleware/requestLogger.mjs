import logger from '../services/logger.mjs';

export function requestLogger(req, res, next) {
  const startedAt = Date.now();
  const { method, originalUrl } = req;

  logger.info('Request started', { method, url: originalUrl });

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    logger.info('Request completed', {
      method,
      url: originalUrl,
      statusCode: res.statusCode,
      durationMs,
    });
  });

  next();
}

export default requestLogger;
