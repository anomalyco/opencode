#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"
import { fileURLToPath } from "url"

console.log("=== publishing ===\n")

await $`bun ./script/sync-version.ts ${Script.version}`

await $`bun install`
await import(`../packages/sdk/js/script/build.ts`)

if (Script.release) {
  if (!Script.preview) {
    await $`git commit -am "release: v${Script.version}"`
    await $`git tag v${Script.version}`
    await $`git fetch origin`
    await $`git cherry-pick HEAD..origin/dev`.nothrow()
    await $`git push origin HEAD --tags --no-verify --force-with-lease`
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }

  await import(`../packages/desktop/scripts/finalize-latest-json.ts`)

  await $`bun install`
  await $`./packages/sdk/js/script/build.ts`
}

if (Script.release && !Script.preview) {
  await $`git fetch origin --tags`
  await $`git switch --detach`
}

await prepareReleaseFiles()

console.log("\n=== cli ===\n")
await $`bun ./packages/opencode/script/publish.ts`

console.log("\n=== sdk ===\n")
await $`bun ./packages/sdk/js/script/publish.ts`

console.log("\n=== plugin ===\n")
await $`bun ./packages/plugin/script/publish.ts`

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
