import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 30_000,
    exclude: ["test/cli/integration.test.ts", "test/fixtures/**"],
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
  },
})
