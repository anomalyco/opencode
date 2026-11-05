#!/usr/bin/env bun

// Builds the two ways `opencode-connect` ships: a self-contained Node bundle for `npx @opencode/connect`, and a
// standalone binary for this platform (harness hooks run it on every tool call, so it must start fast). Pass
// `--target bun-<os>-<arch>` to cross-compile the binary. Signing, notarization and publishing are not wired up yet.

import { rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

process.chdir(fileURLToPath(new URL("..", import.meta.url)))
const options = parseArgs({ options: { target: { type: "string" } } }).values

await rm("dist", { recursive: true, force: true })
const bundle = await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist/npm",
  target: "node",
  format: "esm",
  minify: true,
  splitting: true,
})
if (!bundle.success) throw new AggregateError(bundle.logs, "Node bundle failed")

const binary = await Bun.build({
  entrypoints: ["src/index.ts"],
  minify: true,
  bytecode: true,
  format: "esm",
  compile: {
    ...(options.target ? { target: options.target as Bun.Build.CompileTarget } : {}),
    outfile: `dist/bin/opencode-connect${options.target?.includes("windows") || (!options.target && process.platform === "win32") ? ".exe" : ""}`,
  },
})
if (!binary.success) throw new AggregateError(binary.logs, "Binary build failed")
console.log(["dist/npm/index.js", ...binary.outputs.map((output) => output.path)].join("\n"))
