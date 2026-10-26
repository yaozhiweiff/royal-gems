import { defineConfig } from 'vite';
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  build: {
    rollupOptions: { output: { manualChunks: { phaser: ['phaser'] } } },
    // Phaser's renderer is a single cached engine chunk (about 335 KB gzipped).
    chunkSizeWarningLimit: 1400,
  },
  server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:8787' } },
});
