import { defineConfig } from 'vitest/config';

/** Runs the favicon renderer (not part of the normal test suite). */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tools/favicons/*.gen.ts'],
    testTimeout: 600_000,
  },
});
