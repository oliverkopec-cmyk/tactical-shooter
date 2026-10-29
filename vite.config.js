import { defineConfig } from 'vite';
import { sharedCodeVersion } from './server/sharedVersion.js';

export default defineConfig(({ command }) => ({
  root: 'client',
  // Built pages carry the shared-code fingerprint the server checks on connect.
  // The dev server skips the check: it hot-reloads shared code as you edit.
  define: { __SHARED_VERSION__: JSON.stringify(command === 'build' ? sharedCodeVersion() : 'dev') },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 5173,
    // Client imports ../shared
    fs: { allow: ['..'] },
    proxy: {
      '/socket.io': { target: 'http://localhost:3000', ws: true },
      '/api': 'http://localhost:3000',
    },
  },
}));
