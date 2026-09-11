import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './config/env.mjs';
import { initializeDatabase } from './config/database.mjs';
import logger from './services/logger.mjs';
import mediaRoutes from './routes/mediaRoutes.mjs';
import { requestLogger } from './middleware/requestLogger.mjs';
import errorHandler, { notFoundHandler } from './middleware/errorHandler.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const databaseStatus = initializeDatabase();

app.locals.databaseStore = {
  courses: [],
  modules: [],
  lessons: [],
  enrollments: [],
  users: [],
};
app.locals.databaseStatus = databaseStatus;

app.use(requestLogger);
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(config.uploadRoot));

app.use('/api/media', mediaRoutes);
app.use(config.apiPrefix, mediaRoutes);
app.post('/api/upload-media', mediaRoutes.handleUpload ?? ((req, res) => res.status(404).json({ success: false, error: 'Upload route missing.' })));
app.post('/api/delete-entity', mediaRoutes.handleDelete ?? ((req, res) => res.status(404).json({ success: false, error: 'Delete route missing.' })));

app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: 'ok',
      environment: config.env,
      uploadRoot: config.uploadRoot,
      databasePath: config.databasePath,
      databaseStatus,
    },
    message: 'Backend is healthy.',
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(config.port, () => {
  if (databaseStatus.initialized) {
    logger.info(`Backend API running on http://localhost:${config.port} with SQLite database enabled at ${databaseStatus.databasePath}`);
  } else {
    logger.warn(`Backend API running on http://localhost:${config.port} without SQLite; local mock database mode is active. ${databaseStatus.error ?? ''}`);
  }
});

export default app;
