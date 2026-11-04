import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: '0.0.0.0', port: 5173, strictPort: true },
  build: {
    outDir: 'www',
    emptyOutDir: true,
    manifest: true,
    target: 'es2022'
  }
});
