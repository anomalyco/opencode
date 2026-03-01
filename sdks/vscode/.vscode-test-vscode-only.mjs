import { defineConfig } from "@vscode/test-cli"
export default defineConfig([
  {
    label: "unit",
    files: "out/vscode/*.test.js",
  },
])
