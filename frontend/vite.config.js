import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// "@domain" = backend/src/domain: the dependency-free business rules (statuses, validation, workflow) shared with the API,
// so the wizard validates exactly like the server does.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@domain': fileURLToPath(new URL('../backend/src/domain', import.meta.url)) },
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    proxy: { '/api': 'http://localhost:4000' },
    fs: { allow: ['..'] },
  },
  build: { outDir: 'dist', sourcemap: true },
});
