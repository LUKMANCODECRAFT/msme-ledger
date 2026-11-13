import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      mongoose: path.resolve(__dirname, 'server/node_modules/mongoose'),
      argon2: path.resolve(__dirname, 'server/node_modules/argon2'),
      jsonwebtoken: path.resolve(__dirname, 'server/node_modules/jsonwebtoken')
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
  },
});

