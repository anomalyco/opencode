#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"
import { fileURLToPath } from "url"

console.log("=== publishing ===\n")

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)
const tag = `v${Script.version}`

const pkgjsons = await Array.fromAsync(
  new Bun.Glob("**/package.json").scan({
    absolute: true,
  }),
).then((arr) => arr.filter((x) => !x.includes("node_modules") && !x.includes("dist")))

async function prepareReleaseFiles() {
  for (const file of pkgjsons) {
    let pkg = await Bun.file(file).text()
    pkg = pkg.replaceAll(/"version": "[^"]+"/g, `"version": "${Script.version}"`)
    console.log("updated:", file)
    await Bun.file(file).write(pkg)
  }

  await $`bun install`
  await $`./packages/sdk/js/script/build.ts`
}

if (Script.release && !Script.preview) {
  await $`git fetch origin --tags`
  await $`git switch --detach`
}

await prepareReleaseFiles()

console.log("\n=== schema ===\n")
await $`bun ./packages/schema/script/publish.ts`

console.log("\n=== protocol ===\n")
await $`bun ./packages/protocol/script/publish.ts`

console.log("\n=== client ===\n")
await $`bun ./packages/client/script/publish.ts`

console.log("\n=== cli ===\n")
await $`bun ./packages/cli/script/publish.ts`

console.log("\n=== sdk ===\n")
await $`bun ./packages/sdk/js/script/publish.ts`

console.log("\n=== plugin ===\n")
await $`bun ./packages/plugin/script/publish.ts`

console.log("\n=== ui ===\n")
await $`bun ./packages/ui/script/publish.ts`

if (Script.release) {
  await $`bun ./packages/desktop/scripts/finalize-latest-json.ts`
  await $`bun ./packages/desktop/scripts/finalize-latest-yml.ts`
}

if (Script.release && !Script.preview) {
  await $`git commit -am "release: ${tag}"`
  await $`git tag -d ${tag}`.nothrow()
  await $`git tag ${tag}`
  await $`git push origin refs/tags/${tag} --force-with-lease --no-verify`
  await new Promise((resolve) => setTimeout(resolve, 5_000))
  await $`git fetch origin`
  await $`git checkout -B dev origin/dev`
  await prepareReleaseFiles()
  await $`git commit -am "sync release versions for ${tag}"`
  await $`git push origin HEAD:dev --no-verify`
}

if (Script.release) {
  await $`gh release edit ${tag} --draft=false --repo ${process.env.GH_REPO}`
}
