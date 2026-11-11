import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/cdk.out/**'],
    // CDK synth bundles every Lambda with esbuild; under load that exceeds the 5 s default.
    testTimeout: 30_000,
  },
});
