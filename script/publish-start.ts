#!/usr/bin/env bun

import { $ } from "bun"
import { Script } from "@opencode-ai/script"
import { buildNotes, getLatestRelease } from "./changelog"

let notes: string[] = []

console.log("=== publishing ===\n")

if (!Script.preview) {
  const previous = await getLatestRelease()
  notes = await buildNotes(previous, "HEAD")
}

const pkgjsons = await Array.fromAsync(
  new Bun.Glob("**/package.json").scan({
    absolute: true,
  }),
).then((arr) => arr.filter((x) => !x.includes("node_modules") && !x.includes("dist")))

for (const file of pkgjsons) {
  let pkg = await Bun.file(file).text()
  pkg = pkg.replaceAll(/"version": "[^"]+"/g, `"version": "${Script.version}"`)
  console.log("updated:", file)
  await Bun.file(file).write(pkg)
}

const extensionToml = new URL("../packages/extensions/zed/extension.toml", import.meta.url).pathname
let toml = await Bun.file(extensionToml).text()
toml = toml.replace(/^version = "[^"]+"/m, `version = "${Script.version}"`)
toml = toml.replaceAll(/releases\/download\/v[^/]+\//g, `releases/download/v${Script.version}/`)
console.log("updated:", extensionToml)
await Bun.file(extensionToml).write(toml)

await $`bun install`

console.log("\n=== opencode ===\n")
await import(`../packages/opencode/script/publish.ts`)

console.log("\n=== sdk ===\n")
await import(`../packages/sdk/js/script/publish.ts`)

console.log("\n=== plugin ===\n")
await import(`../packages/plugin/script/publish.ts`)

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

let output = `version=${Script.version}\n`

if (!Script.preview) {
  await $`git commit -am "release: v${Script.version}"`
  await $`git tag v${Script.version}`
  await $`git fetch origin`
  await $`git cherry-pick HEAD..origin/dev`.nothrow()
  await $`git push origin HEAD --tags --no-verify --force-with-lease`
  await new Promise((resolve) => setTimeout(resolve, 5_000))
  await $`gh release create v${Script.version} -d --title "v${Script.version}" --notes ${notes.join("\n") || "No notable changes"} ./packages/opencode/dist/*.zip ./packages/opencode/dist/*.tar.gz`
  const release = await $`gh release view v${Script.version} --json id,tagName`.json()
  output += `release=${release.id}\n`
  output += `tag=${release.tagName}\n`
}

if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, output)
}
