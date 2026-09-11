import { AppError } from './errorHandler.mjs';

const allowedVideoMimeTypes = new Set([
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'video/x-matroska',
]);

const allowedAttachmentMimeTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'application/rtf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

export function validateUploadRequest(req, res, next) {
  const type = String(req.body?.type ?? '').trim().toLowerCase();
  const file = req.file || req.files?.[0];

  if (!file) {
    return next(new AppError('No file uploaded.', 400, { field: 'file' }));
  }

  const mimeType = String(file.mimetype ?? '').trim().toLowerCase();
  const allowedTypes = type === 'video' || mimeType.startsWith('video/') ? allowedVideoMimeTypes : allowedAttachmentMimeTypes;

  if (!allowedTypes.has(mimeType)) {
    return next(new AppError('Unsupported file type for upload.', 415, {
      acceptedTypes: [...allowedTypes],
      receivedType: mimeType,
    }));
  }

  if (type && !['video', 'attachment'].includes(type)) {
    return next(new AppError('Upload type must be video or attachment.', 400, { receivedType: type }));
  }

  return next();
}

export function validateDeleteRequest(req, res, next) {
  const entity = req.body?.entity ?? req.body?.course ?? req.body?.lesson ?? req.body ?? null;

  if (!entity || typeof entity !== 'object') {
    return next(new AppError('Missing entity payload for deletion cleanup.', 400, { body: req.body }));
  }

  if (!entity.id && !entity.courseId && !entity.lessonId && !entity.moduleId) {
    return next(new AppError('Entity payload must include an identifier for cleanup.', 400, {
      receivedKeys: Object.keys(entity),
    }));
  }

  return next();
}
