#!/usr/bin/env bun

import { $ } from "bun"
import { tmpdir } from "os"
import { join } from "path"

const FORK_REPO = "sst/zed-extensions"
const UPSTREAM_REPO = "zed-industries/extensions"
const EXTENSION_NAME = "opencode"
const OPENCODE_REPO = "sst/opencode"

async function main() {
  const version = process.argv[2]
  if (!version) throw new Error("Version argument required: bun script/sync-zed.ts v1.0.52")

  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error("GITHUB_TOKEN environment variable required")

  const cleanVersion = version.replace(/^v/, "")
  console.log(`📦 Syncing Zed extension for version ${cleanVersion}`)

  const commitSha = await $`git rev-parse ${version}`.text()
  const sha = commitSha.trim()
  console.log(`🔍 Found commit SHA: ${sha}`)

  const extensionToml = await $`git show ${version}:packages/extensions/zed/extension.toml`.text()
  const parsed = Bun.TOML.parse(extensionToml) as { version: string }
  const extensionVersion = parsed.version

  if (extensionVersion !== cleanVersion) {
    throw new Error(`Version mismatch: extension.toml has ${extensionVersion} but tag is ${cleanVersion}`)
  }
  console.log(`✅ Version ${extensionVersion} matches tag`)

  // Clone the fork to a temp directory
  const workDir = join(tmpdir(), `zed-extensions-${Date.now()}`)
  console.log(`📁 Working in ${workDir}`)

  await $`git clone https://x-access-token:${token}@github.com/${FORK_REPO}.git ${workDir}`
  process.chdir(workDir)

  // Sync fork with upstream
  console.log(`🔄 Syncing fork with upstream...`)
  await $`git remote add upstream https://github.com/${UPSTREAM_REPO}.git`
  await $`git fetch upstream`
  await $`git checkout main`
  await $`git merge upstream/main --ff-only`
  await $`git push origin main`
  console.log(`✅ Fork synced`)

  // Create a new branch
  const branchName = `update-${EXTENSION_NAME}-${cleanVersion}`
  console.log(`🌿 Creating branch ${branchName}`)
  await $`git checkout -b ${branchName}`

  const submodulePath = `extensions/${EXTENSION_NAME}`
  console.log(`📌 Updating submodule to commit ${sha}`)
  await $`git submodule update --init ${submodulePath}`
  process.chdir(submodulePath)
  await $`git fetch`
  await $`git checkout ${sha}`
  process.chdir(workDir)
  await $`git add ${submodulePath}`

  console.log(`📝 Updating extensions.toml`)
  const extensionsTomlPath = "extensions.toml"
  const extensionsToml = await Bun.file(extensionsTomlPath).text()

  const versionRegex = new RegExp(`(\\[${EXTENSION_NAME}\\][\\s\\S]*?)version = "[^"]+"`)
  const updatedToml = extensionsToml.replace(versionRegex, `$1version = "${cleanVersion}"`)

  if (updatedToml === extensionsToml) {
    throw new Error(`Failed to update version in extensions.toml - pattern not found`)
  }

  await Bun.write(extensionsTomlPath, updatedToml)
  await $`git add extensions.toml`

  const commitMessage = `Update ${EXTENSION_NAME} to v${cleanVersion}

Release notes:

https://github.com/${OPENCODE_REPO}/releases/tag/v${cleanVersion}`

  await $`git commit -m ${commitMessage}`
  console.log(`✅ Changes committed`)

  console.log(`🚀 Pushing to fork...`)
  await $`git push https://x-access-token:${token}@github.com/${FORK_REPO}.git ${branchName}`

  console.log(`📬 Creating pull request...`)
  const prUrl =
    await $`gh pr create --repo ${UPSTREAM_REPO} --base main --head ${FORK_REPO.split("/")[0]}:${branchName} --title "Update ${EXTENSION_NAME} to v${cleanVersion}" --body "Release notes:\n\nhttps://github.com/${OPENCODE_REPO}/releases/tag/v${cleanVersion}"`.text()

  console.log(`✅ Pull request created: ${prUrl}`)
  console.log(`🎉 Done!`)
}

main().catch((err) => {
  console.error("❌ Error:", err.message)
  process.exit(1)
})
