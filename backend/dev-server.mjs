import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import './server.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const viteBin = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const viteProcess = spawn(process.execPath, [viteBin], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: false,
});

viteProcess.on('exit', (code, signal) => {
  const reason = signal ? `signal ${signal}` : `exit code ${code}`;
  console.error(`Vite ended: ${reason}`);
  process.exit(code ?? 1);
});

setInterval(() => {}, 60_000);
