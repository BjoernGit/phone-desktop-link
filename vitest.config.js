import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: './client/src/test/setup.js',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './client/src'),
      // Force a single React copy: component sources under client/ would
      // otherwise resolve react from client/node_modules while the test
      // tooling loads it from the root - two copies break the hooks
      // dispatcher. Point sources at the root copy (same version).
      react: path.resolve(__dirname, './node_modules/react'),
      'react-dom': path.resolve(__dirname, './node_modules/react-dom'),
    },
  },
});
