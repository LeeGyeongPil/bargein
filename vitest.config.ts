import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The integration test runs a real-time render thread; one retry absorbs a loaded CI machine.
    retry: 1,
  },
});
