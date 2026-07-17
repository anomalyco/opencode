#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"
import { fileURLToPath } from "url"

console.log("=== publishing ===\n")

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)
const releaseVersion = Script.version.replace(/^v/, "")
const tag = releaseVersion

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
}

if (Script.release && !Script.preview) {
  await $`git fetch origin --tags`
  await $`git switch --detach`
}

await prepareReleaseFiles()

console.log("\n=== kancode ===\n")
await $`bun ./packages/opencode/script/publish.ts`

if (Script.release && !Script.preview) {
  await $`git commit -am "release: ${tag}"`.nothrow()
  await $`git tag -d ${tag}`.nothrow()
  await $`git tag ${tag}`
  const isCI = !!process.env["GITHUB_ACTIONS"]
  if (isCI) {
    // Tag already exists on origin (it triggered this workflow). Just ensure local tag matches.
    await $`git push origin ${tag} --force --no-verify`
  } else {
    await $`git push origin refs/tags/${tag} --force-with-lease --no-verify`
  }
  await new Promise((resolve) => setTimeout(resolve, 5_000))
  await $`git fetch origin`
  await $`git checkout -B dev origin/dev`
  await prepareReleaseFiles()
  await $`git commit -am "sync release versions for ${tag}"`
  await $`git push origin HEAD:dev --no-verify`
}

const ghRepo = process.env.GH_REPO || (await $`git remote get-url origin`.text()).trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "")

if (Script.release) {
  const view = await $`gh release view ${tag} --repo ${ghRepo}`.nothrow()
  if (view.exitCode !== 0) {
    console.log("creating release", tag)
    await $`gh release create ${tag} --repo ${ghRepo} --generate-notes`
    const archives = await Array.fromAsync(
      new Bun.Glob("**/*.{zip,tar.gz}").scan({ cwd: "packages/opencode/dist" }),
    )
    if (archives.length > 0) {
      await $`gh release upload ${tag} ${archives.map((a) => `packages/opencode/dist/${a}`).join(" ")} --clobber --repo ${ghRepo}`
    }
  } else {
    await $`gh release edit ${tag} --draft=false --repo ${ghRepo}`
  }
}