#!/usr/bin/env bun

import { $ } from "bun"

const snapshot = process.env["OPENCODE_SNAPSHOT"] === "true"
const version = snapshot
  ? `0.0.0-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  : process.env["OPENCODE_VERSION"]
if (!version) {
  throw new Error("OPENCODE_VERSION is required")
}
process.env["OPENCODE_VERSION"] = version

await import(`../packages/opencode/script/publish.ts`)
await import(`../packages/sdk/js/script/publish.ts`)
// await import(`../packages/sdk/stainless/generate.ts`)

if (!snapshot) {
  await $`git commit -am "Release v${version}"`
  await $`git tag v${version}`
  await $`git push origin HEAD --tags`
}
if (snapshot) {
  await $`git commit --allow-empty -m "Snapshot release v${version}"`
  await $`git tag v${version}`
  await $`git push origin v${version}`
  await $`git reset --soft HEAD~1`
}
