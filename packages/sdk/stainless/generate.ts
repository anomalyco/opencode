#!/usr/bin/env bun
import { $ } from "bun"
const dir = new URL(".", import.meta.url).pathname
process.chdir(dir)

console.log("=== Generating Stainless SDK ===")
console.log(process.cwd())

await $`rm -rf go`
await $`bun run ../../opencode/src/index.ts generate > openapi.json`
await $`stl builds create --branch main --pull --allow-empty --+target go`

await $`rm -rf ../go`
await $`mv opencode-go/ ../go`
await $`rm -rf ../go/.git`
