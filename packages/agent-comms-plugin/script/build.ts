#!/usr/bin/env bun
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { $ } from "bun"

await $`rm -rf dist`
const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  naming: "[dir]/server.js",
  target: "bun",
  minify: false,
  external: ["@opencode-ai/plugin", "@opencode-ai/sdk"],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
for (const output of result.outputs) {
  console.log(`built ${output.path} (${output.kind}, ${output.size} bytes)`)
}
