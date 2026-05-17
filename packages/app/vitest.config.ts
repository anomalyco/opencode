import { defineConfig } from "vitest/config"

/** Fast integration tests only (no Docker stack). Browser E2E uses `vitest.e2e.config.ts`. */
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 300_000,
    pool: "forks",
    maxForks: 1,
  },
})
