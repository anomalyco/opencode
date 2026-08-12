#!/usr/bin/env bun
/**
 * Bundle probe for the workerd profile: verifies the full module graph behind
 * src/workerd.ts resolves under the `workerd` condition without any `bun:`
 * builtins. `node:` builtins stay external (workerd provides them through
 * nodejs_compat); the probe prints the surviving externals so the A4 boot
 * spike knows exactly what the runtime must supply.
 */
import path from "node:path"
import { mkdtempSync } from "node:fs"
import os from "node:os"

const outdir = mkdtempSync(path.join(os.tmpdir(), "opencode-workerd-probe-"))
const result = await Bun.build({
  entrypoints: [path.join(import.meta.dir, "../src/workerd.ts")],
  conditions: ["workerd"],
  target: "node",
  outdir,
  sourcemap: "none",
  throw: false,
})

if (!result.success) {
  console.error(`workerd bundle probe FAILED (${result.logs.length} issues)`)
  for (const log of result.logs) console.error(String(log))
  process.exit(1)
}

// Everything in the graph is bundled, so any import specifier that survives in
// the output is an external the runtime must provide.
const transpiler = new Bun.Transpiler({ loader: "js" })
const externals = new Set<string>()
for (const artifact of result.outputs) {
  const text = await artifact.text()
  for (const imported of transpiler.scanImports(text)) externals.add(imported.path)
  for (const match of text.matchAll(/\brequire\(\s*"([^"]+)"\s*\)/g)) externals.add(match[1])
}
const sorted = Array.from(externals).toSorted()
const bun = sorted.filter((specifier) => specifier === "bun" || specifier.startsWith("bun:"))
const bytes = result.outputs.reduce((total, artifact) => total + artifact.size, 0)

console.log(`workerd bundle probe OK: ${result.outputs.length} artifacts, ${(bytes / 1024 / 1024).toFixed(1)} MiB`)
console.log(`external builtins (${sorted.length}):`)
for (const specifier of sorted) console.log(`  ${specifier}`)
if (bun.length > 0) {
  console.error(`FAILED: bun builtins leaked into the workerd graph: ${bun.join(", ")}`)
  process.exit(1)
}
