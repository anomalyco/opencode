#!/usr/bin/env bun
// Builds dist/: index.js (the page side), worker.js (the worker, with the wasm-bindgen glue), the .wasm module from
// wasm/ (scripts/build-wasm.sh), and the .d.ts files.

import { $ } from "bun"
import { cp, rm } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const dist = path.join(root, "dist")
await rm(dist, { recursive: true, force: true })
const built = await Bun.build({
  entrypoints: [path.join(root, "src/index.ts"), path.join(root, "src/worker.ts")],
  outdir: dist,
  format: "esm",
  target: "browser",
  minify: true,
  sourcemap: "linked",
  naming: "[name].[ext]",
})
if (!built.success) {
  for (const log of built.logs) console.error(log)
  process.exit(1)
}
await cp(path.join(root, "wasm/widget_web_bg.wasm"), path.join(dist, "widget_web_bg.wasm"))
await $`bun x tsc -p ${path.join(root, "tsconfig.build.json")}`.cwd(root)
for (const f of await Array.fromAsync(new Bun.Glob("*").scan(dist)))
  console.log(f.padEnd(36), (Bun.file(path.join(dist, f)).size / 1024).toFixed(1).padStart(8), "KB")
