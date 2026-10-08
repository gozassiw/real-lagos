import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base: the same build works from any folder (GitHub Pages /real-lagos/, Cloudflare Pages root, previews).
export default defineConfig({
  base: process.env.BASE_PATH || './',
  plugins: [react()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
});
