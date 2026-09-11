import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logDirectory = path.resolve(__dirname, '..', 'logs');
const logFilePath = path.join(logDirectory, 'app.log');

if (!fs.existsSync(logDirectory)) {
  fs.mkdirSync(logDirectory, { recursive: true });
}

const formatPrefix = (level) => `[${new Date().toISOString()}] [${level}]`;

const writeToFile = (level, payload) => {
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
  fs.appendFileSync(logFilePath, `${formatPrefix(level)} ${serialized}\n`, 'utf8');
};

const logger = {
  info: (...args) => {
    const message = args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
    console.log(formatPrefix('INFO'), message);
    writeToFile('INFO', message);
  },
  warn: (...args) => {
    const message = args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
    console.warn(formatPrefix('WARN'), message);
    writeToFile('WARN', message);
  },
  error: (...args) => {
    const message = args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
    console.error(formatPrefix('ERROR'), message);
    writeToFile('ERROR', message);
  },
  debug: (...args) => {
    if (process.env.NODE_ENV === 'development') {
      const message = args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
      console.debug(formatPrefix('DEBUG'), message);
      writeToFile('DEBUG', message);
    }
  },
};

export default logger;
