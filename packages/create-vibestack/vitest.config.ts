import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
    sequence: { shuffle: false, seed: 1 },
    retry: 0,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
