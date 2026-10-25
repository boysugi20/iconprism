import { defineConfig } from 'vite';

// Relative base so the build works under any GitHub Pages path.
// Icon-library weights are deliberately large lazy chunks (~180 KB gzipped each).
export default defineConfig({ base: './', build: { chunkSizeWarningLimit: 1200 } });
