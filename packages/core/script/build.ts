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
  external: [
    "#sqlite",
    "#pty",
    "#persistent-pty-binary",
    "#fff",
    "#photon-wasm",
    "#shell-parser-wasm",
    "#process-lock-ffi",
    "#v1-migration",
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

// Bun's Node target eagerly creates its shared require helper, so every split
// entry evaluates import.meta.url even when it never requires a module. Keep
// the helper lazy until Bun stops hoisting it into workerd-reachable chunks.
// https://github.com/oven-sh/bun/issues/12615
const eagerRequire = "var __require = /* @__PURE__ */ createRequire(import.meta.url);"
const lazyRequire = `var __require = (specifier) => createRequire(import.meta.url ?? "file:///worker.js")(specifier);
__require.resolve = (specifier, options) => createRequire(import.meta.url ?? "file:///worker.js").resolve(specifier, options);`
const rewritten = await Promise.all(
  result.outputs.map(async (output) => {
    if (!output.path.endsWith(".js")) return false
    const source = await output.text()

    const generatedUses = source
      .replace(/import\s*\{[^}]*\b__require\b[^}]*\}\s*from\s*["'][^"']+["'];/g, "")
      .replace(/export\s*\{[^}]*\b__require\b[^}]*\};/g, "")
      .replace(eagerRequire, "")
    if (/\bnew\s+__require\s*\(/.test(generatedUses))
      throw new Error(`Unsupported generated require constructor in ${output.path}`)
    const unsupported = generatedUses.replace(/\b__require\.resolve\s*\(/g, "").replace(/\b__require\s*\(/g, "")
    if (/\b__require\b/.test(unsupported)) throw new Error(`Unsupported generated require usage in ${output.path}`)

    if (!source.includes(eagerRequire)) return false
    if (source.indexOf(eagerRequire) !== source.lastIndexOf(eagerRequire))
      throw new Error(`Multiple eager require helpers in ${output.path}`)
    const rewrittenSource = source.replace(eagerRequire, lazyRequire)
    if (rewrittenSource.includes(eagerRequire))
      throw new Error(`Failed to rewrite eager require helper in ${output.path}`)
    await Bun.write(output.path, rewrittenSource)
    return true
  }),
)
if (rewritten.filter(Boolean).length !== 1)
  throw new Error("Expected exactly one eager require helper; Bun may have fixed #12615 and made this shim removable")
