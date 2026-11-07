import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths, so the site works from a GitHub Pages project URL (/<repo>/) or any sub-folder.
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js is most of the bundle; splitting it buys nothing for a single-page app.
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
