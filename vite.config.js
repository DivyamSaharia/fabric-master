import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`      -> dist/       the installable app (host these files)
// `npm run build:demo` -> dist-demo/  one self-contained HTML file in demo mode, for a quick look
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [preact(), ...(mode === 'demo' ? [viteSingleFile()] : [])],
  build: {
    outDir: mode === 'demo' ? 'dist-demo' : 'dist',
    emptyOutDir: true,
    // flat output: every file sits at the site root, so it can be uploaded to GitHub in one go
    assetsDir: '',
    chunkSizeWarningLimit: 1200,
  },
  test: { environment: 'jsdom' },
}));
