import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

const envCandidates = [
  path.resolve(projectRoot, '.env'),
  path.resolve(projectRoot, 'backend', '.env'),
  path.resolve(projectRoot, 'server', '.env'),
];

for (const envPath of envCandidates) {
  dotenv.config({ path: envPath });
}

const databasePathFromEnv = process.env.DATABASE_PATH || process.env.LOCAL_DB_PATH || process.env.VITE_DATABASE_URL || './data/educational_platform.db';
const normalizedDatabasePath = databasePathFromEnv.startsWith('sqlite:///')
  ? databasePathFromEnv.replace('sqlite:///', '')
  : databasePathFromEnv;

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.BACKEND_PORT || process.env.PORT || 3001),
  projectRoot,
  databasePath: path.resolve(projectRoot, normalizedDatabasePath),
  uploadRoot: path.resolve(projectRoot, process.env.UPLOAD_ROOT || 'public/uploads'),
  apiPrefix: process.env.API_PREFIX || '/api',
};
