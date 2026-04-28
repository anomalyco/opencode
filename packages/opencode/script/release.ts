#!/usr/bin/env bun

import { $ } from "bun"
import { Script } from "@opencode-ai/script"
import { fileURLToPath } from "url"
import path from "path"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const skipBuild = process.argv.includes("--skip-build")
const skipWebUi = process.argv.includes("--skip-web-ui")

async function syncVersionFiles() {
  const files = [path.resolve(dir, "package.json"), path.resolve(dir, "../../package.json")]
  await Promise.all(
    files.map(async (file) => {
      const pkg = await Bun.file(file).json()
      await Bun.file(file).write(JSON.stringify({ ...pkg, version: Script.version }, null, 2) + "\n")
      console.log(`📝 Synced version ${Script.version} in ${path.relative(dir, file)}`)
    }),
  )
}

console.log("🚀 OpenCode Release Pipeline")
console.log("============================\n")

// Auto-detect bump type from git commits since last tag
const lastTag = await $`git describe --tags --abbrev=0`.text().then((x) => x.trim()).catch(() => "")
const commits = lastTag
  ? await $`git log ${lastTag}..HEAD --pretty=format:%s`.text().then((x) => x.trim().split("\n").filter(Boolean))
  : []

const bump = (() => {
  if (commits.some((c) => c.includes("BREAKING CHANGE") || /^[a-z]+(\(.+\))?!:/.test(c))) return "major"
  if (commits.some((c) => /^feat(\(.+\))?:/.test(c))) return "minor"
  return "patch"
})()

console.log(`📌 Last tag: ${lastTag || "(none)"}`)
console.log(`📝 ${commits.length} commits since last release`)
console.log(`⬆️  Auto bump: ${bump}\n`)

process.env.OPENCODE_BUMP = bump

// Step 1: Build
if (skipBuild) {
  console.log("⏭️  Skipping build (--skip-build)\n")
} else {
  console.log("🔨 Step 1: Building binary for current platform...")
  const buildArgs = ["--single"]
  if (skipWebUi) buildArgs.push("--skip-embed-web-ui")
  await $`bun run script/build.ts ${buildArgs}`
  console.log("✅ Build complete\n")
}

// Step 2: Publish (npm only)
console.log("📦 Step 2: Publishing to npm...")
process.env.OPENCODE_NPM_ONLY = "true"
for (let i = 0; i < 5; i++) {
  const result = await $`bun run script/publish.ts`.nothrow()
  if (result.exitCode === 0) break
  if (i === 4) throw new Error(result.stderr.toString())
  console.log(`⏳ Publish attempt ${i + 1} failed, waiting for npm registry propagation before retrying...\n`)
  await Bun.sleep(5000)
}
await syncVersionFiles()
console.log("\n✅ Published successfully!")
