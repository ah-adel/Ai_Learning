import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';

import { config } from '../config/env.mjs';
import { AppError } from '../middleware/errorHandler.mjs';
import { cleanupDeletionArtifacts } from './cleanupService.mjs';

const uploadRoot = config.uploadRoot;

const ensureDirectory = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
};

export const resolveUploadKind = (value, mimeType = '') => {
  const mime = String(mimeType ?? '').trim().toLowerCase();
  const requestedKind = String(value ?? '').trim().toLowerCase();

  if (mime.startsWith('video/') || requestedKind === 'video' || requestedKind === 'videos') {
    return 'video';
  }

  return 'attachment';
};

export const getUploadFolder = (kind) => (kind === 'video' ? 'videos' : 'attachments');
export const getKindLimit = (kind) => (kind === 'video' ? 500 * 1024 * 1024 : 20 * 1024 * 1024);

export const allowedMimeTypes = {
  video: new Set(['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-matroska']),
  attachment: new Set([
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
  ]),
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const kind = resolveUploadKind(req.body?.type, file.mimetype);
    const targetDir = ensureDirectory(path.join(uploadRoot, getUploadFolder(kind)));
    cb(null, targetDir);
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname || 'upload.bin');
    const baseName = (file.originalname || 'upload')
      .replace(new RegExp(`${extension.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 80) || 'upload';
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${baseName}-${uniqueSuffix}${extension}`);
  },
});

export const uploadMedia = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const kind = resolveUploadKind(req.body?.type, file.mimetype);
    const allowed = allowedMimeTypes[kind] ?? allowedMimeTypes.attachment;

    if (allowed.has(file.mimetype)) {
      cb(null, true);
      return;
    }

    cb(new AppError(`Invalid file type for ${kind}.`, 415, { receivedType: file.mimetype }));
  },
});

ensureDirectory(path.join(uploadRoot, 'videos'));
ensureDirectory(path.join(uploadRoot, 'attachments'));

export async function processMediaUpload(req) {
  if (!req.file) {
    throw new AppError('No file uploaded.', 400, { field: 'file' });
  }

  const detectedKind = resolveUploadKind(req.body?.type, req.file.mimetype);
  const maxFileSize = getKindLimit(detectedKind);

  if (req.file.size > maxFileSize) {
    fs.unlinkSync(req.file.path);
    throw new AppError('File exceeds the allowed size limit.', 413, {
      maxFileSize,
      receivedFileSize: req.file.size,
    });
  }

  const folder = getUploadFolder(detectedKind);
  const url = `/uploads/${folder}/${req.file.filename}`;

  return {
    url,
    folder,
    type: detectedKind,
    fileName: req.file.filename,
    originalName: req.file.originalname,
  };
}

export async function processDeletion(req) {
  const entity = req.body?.entity ?? req.body?.course ?? req.body?.lesson ?? req.body ?? null;

  if (!entity || typeof entity !== 'object') {
    throw new AppError('Missing entity payload for deletion cleanup.', 400, { body: req.body });
  }

  const cleanupResult = cleanupDeletionArtifacts(entity, {
    projectRoot: config.projectRoot,
    databaseStore: req.app.locals.databaseStore ?? {},
  });

  return cleanupResult;
}
