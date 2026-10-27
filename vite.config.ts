import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_PORT = process.env.AGENDA_PORT ?? '8787';

export default defineConfig({
  root: '.',
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': `http://127.0.0.1:${API_PORT}`,
    },
  },
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
  },
});
