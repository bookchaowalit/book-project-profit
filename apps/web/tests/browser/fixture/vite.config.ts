import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '../../..');

export default defineConfig({
  root: here,
  plugins: [react()],
  resolve: { alias: { '@': web } },
  server: { host: '127.0.0.1', port: 4173, strictPort: true, fs: { allow: [web] } },
});
