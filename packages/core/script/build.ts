#!/usr/bin/env bun

import { $ } from "bun"
import { rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

process.chdir(fileURLToPath(new URL("..", import.meta.url)))

await rm("dist", { recursive: true, force: true })
await $`bun tsc -p tsconfig.build.json`

const root = path.resolve("src")
const files = await Array.fromAsync(new Bun.Glob("**/*.ts").scan({ cwd: root, absolute: true }))
const result = await Bun.build({
  entrypoints: files.filter((file) => !file.endsWith(".d.ts")),
  root,
  outdir: "dist",
  target: "node",
  format: "esm",
  packages: "external",
  external: ["#sqlite", "#pty", "#fff", "#photon-wasm", "#process-lock-ffi", "#v1-migration"],
  plugins: [
    {
      name: "bundle-shell-scan",
      setup(build) {
        build.onResolve({ filter: /^@opencode-ai\/shell-scan$/ }, () => ({
          path: path.resolve("../shell-scan/src/index.ts"),
        }))
      },
    },
  ],
  splitting: true,
  loader: {
    ".txt": "text",
    ".md": "text",
  },
  naming: {
    entry: "[dir]/[name].[ext]",
    chunk: "chunks/[name]-[hash].[ext]",
    asset: "assets/[name]-[hash].[ext]",
  },
})
if (!result.success) throw new AggregateError(result.logs, "Failed to build Core")
