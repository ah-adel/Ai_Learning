import logger from '../services/logger.mjs';
import { processDeletion, processMediaUpload } from '../services/mediaService.mjs';
import { AppError, asyncHandler } from '../middleware/errorHandler.mjs';

const upload = asyncHandler((req, res, next) => {
  if (!req.file) {
    return next(new AppError('No file uploaded.', 400, { field: 'file' }));
  }

  return processMediaUpload(req)
    .then((result) => {
      logger.info('Media upload complete', { fileName: result.fileName, url: result.url });
      return res.status(201).json({
        success: true,
        data: result,
        message: 'Media uploaded successfully.',
      });
    })
    .catch((error) => next(error));
});

const deleteEntity = asyncHandler(async (req, res) => {
  const cleanupResult = await processDeletion(req);

  logger.info('Deletion cleanup completed', {
    entityId: cleanupResult.entityId,
    deletedFiles: cleanupResult.deletedFiles.length,
    purgedCollections: cleanupResult.purgedCollections,
  });

  return res.status(200).json({
    success: true,
    data: cleanupResult,
    message: 'Related media and references were cleaned successfully.',
  });
});

export const mediaController = {
  upload,
  deleteEntity,
};

export default mediaController;
