#!/usr/bin/env bun

import { build } from "bun"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

console.log("Building plugin-sidebar-context...")

const pluginUIPath = path.resolve(__dirname, "../../src/plugin-ui")

const result = await build({
  entrypoints: [path.join(__dirname, "index.tsx")],
  outdir: path.join(__dirname, "dist"),
  target: "bun",
  format: "esm",
  minify: false,
  sourcemap: "external",
  external: [
    "@opencode-ai/sdk",
    "@opentui/solid",
    "@opentui/core",
    // Bundle plugin-ui and solid-js so dist file is standalone
  ],
  naming: {
    entry: "[dir]/[name].js",
  },
})

if (!result.success) {
  console.error("Build failed:", result.logs)
  process.exit(1)
}

console.log("✓ Plugin built successfully to", path.join(__dirname, "dist"))
