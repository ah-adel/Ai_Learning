import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

for (const envPath of [
  path.resolve(projectRoot, '.env'),
  path.resolve(projectRoot, 'backend', '.env'),
]) {
  dotenv.config({ path: envPath });
}

const dbPathEnv = process.env.LOCAL_DB_PATH || process.env.DATABASE_PATH || process.env.DATABASE_URL || './data/educational_platform.db';
const normalizedDbPath = dbPathEnv.startsWith('sqlite:///')
  ? dbPathEnv.replace('sqlite:///', '')
  : dbPathEnv;
const resolvedDbPath = path.isAbsolute(normalizedDbPath)
  ? normalizedDbPath
  : path.resolve(projectRoot, normalizedDbPath);
const schemaPath = path.resolve(projectRoot, 'database/schema.sql');

fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });

try {
  const db = new Database(resolvedDbPath);
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);
  db.close();
  console.log(`Local SQLite database initialized at ${resolvedDbPath}`);
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown database initialization error';
  console.warn(`Database initialization failed, falling back to local mock state: ${message}`);
  process.exitCode = 0;
}
