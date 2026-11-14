import { defineConfig } from 'vitest/config';

export default defineConfig({
  // same constant the UI build defines (Settings shows it)
  define: { __APP_VERSION__: JSON.stringify('test') },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
});
