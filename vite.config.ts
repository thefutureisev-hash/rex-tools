import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `--mode static` builds one self-contained HTML file with prices built in,
// for sharing a test version without a server.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'static' ? [react(), viteSingleFile()] : [react()],
  server: { proxy: { '/api': 'http://localhost:3001' } },
  // The static build keeps the template file the export script copies next to the page
  build: { outDir: mode === 'static' ? 'dist-static' : 'dist', emptyOutDir: mode !== 'static' },
  define: { __STATIC__: JSON.stringify(mode === 'static') },
}));
