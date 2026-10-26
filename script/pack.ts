#!/usr/bin/env bun

import { Script } from "@opencode/script"
import { $ } from "bun"
import { rm } from "node:fs/promises"
import path from "node:path"

// Runs `bun run pack` for every package published to npm, after moving every workspace to the build
// version so workspace dependencies pack at that version. Outputs land in dist/npm and dist/archives.
const root = path.resolve(import.meta.dir, "..")
process.chdir(root)
console.log(`=== packing ${Script.version} (${Script.channel}) ===\n`)

await rm("dist/npm", { recursive: true, force: true })
await rm("dist/archives", { recursive: true, force: true })

const pkgjsons = await Array.fromAsync(new Bun.Glob("**/package.json").scan({ absolute: true })).then((files) =>
  files.filter((file) => !file.includes("node_modules") && !file.includes("dist")),
)
for (const file of pkgjsons) {
  const text = await Bun.file(file).text()
  await Bun.write(file, text.replaceAll(/"version": "[^"]+"/g, `"version": "${Script.version}"`))
}
await $`bun install`

for (const name of [
  "schema",
  "codemode",
  "theme",
  "ai",
  "util",
  "protocol",
  "client",
  "plugin",
  "plugin-browser",
  "core",
  "simulation",
  "server",
  "sdk",
  "ui",
  "cli",
]) {
  console.log(`\n=== ${name} ===\n`)
  await $`bun run pack`.cwd(path.join("packages", name))
}
