import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const appDir = path.dirname(fileURLToPath(import.meta.url))

/** Fast integration tests only (no Docker stack). Browser E2E uses `vitest.e2e.config.ts`. */
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    setupFiles: [path.join(appDir, "test/support/tc-wire-setup.ts")],
    testTimeout: 120_000,
    hookTimeout: 300_000,
    pool: "forks",
    maxForks: 1,
  },
})
