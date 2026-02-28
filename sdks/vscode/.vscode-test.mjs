import { defineConfig } from "@vscode/test-cli"

/**
 * VS Code Test CLI configuration.
 * Supports multiple test configurations:
 * - unit: Unit tests with mocked VS Code APIs
 * - integration: Integration tests requiring Extension Host
 */
export default defineConfig([
  // Unit tests (default)
  {
    label: "unit",
    files: "out/src/acp/*.test.js",
  },
  {
    label: "unit",
    files: "out/src/vscode/*.test.js",
  },
  // Integration tests (requires Extension Host)
  {
    label: "integration",
    files: "out/src/integration/*.test.js",
  },
])
