import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import { config } from './env.mjs';
import logger from '../services/logger.mjs';

const schemaPath = path.resolve(config.projectRoot, 'database', 'schema.sql');

export function initializeDatabase() {
  const resolvedDatabasePath = config.databasePath;

  try {
    fs.mkdirSync(path.dirname(resolvedDatabasePath), { recursive: true });

    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Database schema file not found at ${schemaPath}`);
    }

    const database = new Database(resolvedDatabasePath);
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    database.exec(schemaSql);
    database.close();

    logger.info(`Database initialized successfully at ${resolvedDatabasePath}`);

    return {
      initialized: true,
      provider: 'sqlite',
      databasePath: resolvedDatabasePath,
      mode: 'local-sqlite',
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown database initialization error';
    logger.warn(`Database initialization failed for ${resolvedDatabasePath}. Falling back to local mock mode. ${message}`);

    return {
      initialized: false,
      provider: 'mock',
      databasePath: resolvedDatabasePath,
      mode: 'mock-local',
      error: message,
    };
  }
}

export default initializeDatabase;
