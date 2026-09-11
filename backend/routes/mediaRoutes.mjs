import express from 'express';

import { validateDeleteRequest, validateUploadRequest } from '../middleware/validation.mjs';
import mediaController from '../controllers/mediaController.mjs';
import { asyncHandler } from '../middleware/errorHandler.mjs';
import { uploadMedia } from '../services/mediaService.mjs';

const router = express.Router();

router.post('/upload', uploadMedia.single('file'), validateUploadRequest, asyncHandler(mediaController.upload));
router.post('/delete', validateDeleteRequest, asyncHandler(mediaController.deleteEntity));
router.post('/upload-media', uploadMedia.single('file'), validateUploadRequest, asyncHandler(mediaController.upload));
router.post('/delete-entity', validateDeleteRequest, asyncHandler(mediaController.deleteEntity));

export { mediaController };
export default router;
