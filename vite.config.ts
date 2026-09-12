import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    watch: {
      ignored: ['**/backend_fastapi/uploads/**'],
    },
    proxy: {
      '/api': 'http://127.0.0.1:8005',
      '/uploads': 'http://127.0.0.1:8005',
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
