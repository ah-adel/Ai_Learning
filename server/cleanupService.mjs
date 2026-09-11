import fs from 'node:fs';
import path from 'node:path';

const MEDIA_FIELD_KEYS = new Set([
  'url',
  'videourl',
  'attachmenturl',
  'videopath',
  'attachmentpath',
  'filepath',
  'fileurl',
  'mediaurl',
  'mediafile',
  'video',
  'attachment',
  'file',
  'path',
  'src',
  'secure_url',
  'file_path',
  'video_url'
]);

function normalizeValue(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function collectCandidateUrls(value, seen = new Set(), results = []) {
  if (!value || typeof value !== 'object') {
    return results;
  }

  if (seen.has(value)) {
    return results;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry) => collectCandidateUrls(entry, seen, results));
    return results;
  }

  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = String(key).toLowerCase();

    if (MEDIA_FIELD_KEYS.has(normalizedKey) && typeof child === 'string') {
      const normalized = normalizeValue(child);
      if (normalized) {
        results.push(normalized);
      }
    }

    if (typeof child === 'object') {
      collectCandidateUrls(child, seen, results);
    }
  }

  return results;
}

export function resolveServerStoragePath(value, projectRoot = process.cwd()) {
  const normalized = normalizeValue(value);
  if (!normalized) {
    return null;
  }

  let relativePath = normalized;

  try {
    const parsedUrl = new URL(normalized);
    relativePath = parsedUrl.pathname;
  } catch {
    // Relative path fallback
  }

  relativePath = relativePath.replace(/^\/+/, '');

  const possiblePaths = [
    path.resolve(projectRoot, 'public', relativePath),
    path.resolve(projectRoot, relativePath),
    path.resolve(projectRoot, 'public', 'uploads', path.basename(relativePath)),
    path.resolve(projectRoot, 'public', 'uploads', 'videos', path.basename(relativePath)),
    path.resolve(projectRoot, 'public', 'uploads', 'attachments', path.basename(relativePath))
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      return p;
    }
  }

  return null;
}

export function collectEntityMediaPaths(entity, projectRoot = process.cwd()) {
  if (!entity || typeof entity !== 'object') {
    return [];
  }

  const uniquePaths = [];
  const seenPaths = new Set();

  collectCandidateUrls(entity).forEach((candidate) => {
    const serverPath = resolveServerStoragePath(candidate, projectRoot);
    if (!serverPath || seenPaths.has(serverPath)) {
      return;
    }

    seenPaths.add(serverPath);
    uniquePaths.push(serverPath);
  });

  return uniquePaths;
}

export function purgeFiles(filePaths = []) {
  const deleted = [];
  const errors = [];

  for (const rawPath of filePaths) {
    try {
      const absolutePath = path.resolve(rawPath);
      if (!fs.existsSync(absolutePath)) {
        continue;
      }

      fs.rmSync(absolutePath, { force: true, recursive: true });
      deleted.push(absolutePath);
    } catch (error) {
      errors.push({
        path: rawPath,
        message: error instanceof Error ? error.message : 'Unknown file deletion error',
      });
    }
  }

  return { deleted, errors };
}

export function purgeEntityReferences(entity, databaseStore = {}) {
  if (!entity || typeof entity !== 'object') {
    return { purgedCollections: [], errors: [] };
  }

  const targetId = entity.id ?? entity.courseId ?? entity.lessonId ?? entity.moduleId ?? entity.entityId ?? null;
  if (!targetId) {
    return { purgedCollections: [], errors: [] };
  }

  const purgedCollections = [];
  const errors = [];

  for (const [collectionName, collectionValue] of Object.entries(databaseStore)) {
    if (!Array.isArray(collectionValue)) {
      continue;
    }

    const nextCollection = collectionValue.filter((entry) => {
      if (!entry || typeof entry !== 'object') {
        return true;
      }

      const matchKeys = ['id', 'courseId', 'lessonId', 'moduleId', 'entityId', 'parentId'];
      return !matchKeys.some((key) => Object.prototype.hasOwnProperty.call(entry, key) && entry[key] === targetId);
    });

    if (nextCollection.length !== collectionValue.length) {
      databaseStore[collectionName] = nextCollection;
      purgedCollections.push(collectionName);
    }
  }

  return { purgedCollections, errors };
}

export function cleanupDeletionArtifacts(entity, options = {}) {
  const { projectRoot = process.cwd(), databaseStore = {} } = options;

  const result = {
    entityId: entity?.id ?? entity?.courseId ?? entity?.lessonId ?? entity?.moduleId ?? null,
    deletedFiles: [],
    purgedCollections: [],
    errors: [],
  };

  try {
    const mediaPaths = collectEntityMediaPaths(entity, projectRoot);
    const purgeResult = purgeFiles(mediaPaths);
    result.deletedFiles = purgeResult.deleted;
    result.errors.push(...purgeResult.errors);
  } catch (error) {
    result.errors.push({
      message: error instanceof Error ? error.message : 'Unknown media cleanup failure',
    });
  }

  try {
    const dbResult = purgeEntityReferences(entity, databaseStore);
    result.purgedCollections = dbResult.purgedCollections;
    result.errors.push(...dbResult.errors);
  } catch (error) {
    result.errors.push({
      message: error instanceof Error ? error.message : 'Unknown reference cleanup failure',
    });
  }

  return result;
}

export function createDeletionCleanupMiddleware({
  projectRoot = process.cwd(),
  databaseStore = {},
  fetchEntityBeforeDelete = async (req) => req.body?.entity ?? req.body?.course ?? req.body?.lesson ?? req.body ?? null,
} = {}) {
  return async function deletionCleanupMiddleware(req, res, next) {
    try {
      const entity = await fetchEntityBeforeDelete(req);
      if (!entity) {
        return next();
      }

      const cleanupResult = cleanupDeletionArtifacts(entity, { projectRoot, databaseStore });
      req.cleanupResult = cleanupResult;
      return next();
    } catch (error) {
      console.error('Deletion cleanup middleware failed gracefully:', error);
      req.cleanupResult = {
        entityId: null,
        deletedFiles: [],
        purgedCollections: [],
        errors: [{ message: error instanceof Error ? error.message : 'Unexpected cleanup failure' }],
      };
      return next();
    }
  };
}