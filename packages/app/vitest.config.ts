import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts", "test/browser/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 300_000,
    pool: "forks",
    maxForks: 1,
  },
})
