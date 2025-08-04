#!/usr/bin/env bun

import { $ } from "bun"

console.log("=== publishing ===\n")

const snapshot = process.env["OPENCODE_SNAPSHOT"] === "true"
const version = snapshot
  ? `0.0.0-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  : process.env["OPENCODE_VERSION"]
if (!version) {
  throw new Error("OPENCODE_VERSION is required")
}
process.env["OPENCODE_VERSION"] = version
console.log("version:", version)

const pkgjsons = await Array.fromAsync(
  new Bun.Glob("**/package.json").scan({
    absolute: true,
  }),
).then((arr) => arr.filter((x) => !x.includes("node_modules") && !x.includes("dist")))

const tree = await $`git add . && git write-tree`.text().then((x) => x.trim())
for (const file of pkgjsons) {
  let pkg = await Bun.file(file).text()
  pkg = pkg.replaceAll(/"version": "[^"]+"/g, `"version": "${version}"`)
  console.log("updated:", file)
  await Bun.file(file).write(pkg)
}

console.log("\n=== opencode ===\n")
await import(`../packages/opencode/script/publish.ts`)

console.log("\n=== sdk ===\n")
await import(`../packages/sdk/js/script/publish.ts`)

console.log("\n=== plugin ===\n")
await import(`../packages/plugin/script/publish.ts`)

if (!snapshot) {
  await $`git commit -am "release: v${version}"`
  await $`git tag v${version}`
  await $`git push origin HEAD --tags --no-verify`
}
if (snapshot) {
  await $`git checkout -b snapshot-${version}`
  await $`git commit --allow-empty -m "Snapshot release v${version}"`
  await $`git tag v${version}`
  await $`git push origin v${version} --no-verify`
  await $`git checkout dev`
  await $`git branch -D snapshot-${version}`
  for (const file of pkgjsons) {
    await $`git checkout ${tree} ${file}`
  }
}
