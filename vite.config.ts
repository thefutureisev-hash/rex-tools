import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `--mode static` builds one self-contained HTML file with prices built in,
// for sharing a test version without a server.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'static' ? [react(), viteSingleFile()] : [react()],
  server: { proxy: { '/api': 'http://localhost:3001' } },
  build: { outDir: mode === 'static' ? 'dist-static' : 'dist' },
  define: { __STATIC__: JSON.stringify(mode === 'static') },
}));
