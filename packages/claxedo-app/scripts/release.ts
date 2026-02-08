#!/usr/bin/env bun
/**
 * Claxedo Release Script
 *
 * This script handles the release process:
 * 1. Version bumping (major/minor/patch)
 * 2. Changelog entry generation
 * 3. Git tag creation
 * 4. Triggers platform-specific builds
 *
 * Usage:
 *   bun ./scripts/release.ts [major|minor|patch] [--dry-run] [--no-tag]
 */

import { file } from "bun"
import { $ } from "bun"

// Parse arguments
const args = Bun.argv.slice(2)
const dryRun = args.includes("--dry-run")
const noTag = args.includes("--no-tag")
const bumpType = args.find((arg) => ["major", "minor", "patch"].includes(arg)) as
  | "major"
  | "minor"
  | "patch"
  | undefined

if (!bumpType) {
  console.error("Usage: bun ./scripts/release.ts [major|minor|patch] [--dry-run] [--no-tag]")
  console.error("")
  console.error("Options:")
  console.error("  major      Bump major version (1.0.0 -> 2.0.0)")
  console.error("  minor      Bump minor version (1.0.0 -> 1.1.0)")
  console.error("  patch      Bump patch version (1.0.0 -> 1.0.1)")
  console.error("  --dry-run  Show what would be done without making changes")
  console.error("  --no-tag   Skip git tag creation")
  process.exit(1)
}

const claxedoAppDir = new URL("..", import.meta.url).pathname

// eslint-disable-next-line no-console
console.log(`[release] Starting release process...`)
// eslint-disable-next-line no-console
console.log(`[release] Bump type: ${bumpType}`)
// eslint-disable-next-line no-console
console.log(`[release] Dry run: ${dryRun}`)

// Step 1: Read current version
const packageJsonPath = `${claxedoAppDir}/package.json`
const packageJson = await file(packageJsonPath).json()
const currentVersion = packageJson.version as string

// eslint-disable-next-line no-console
console.log(`[release] Current version: ${currentVersion}`)

// Step 2: Calculate new version
function bumpVersion(version: string, type: "major" | "minor" | "patch"): string {
  const parts = version.split(".").map(Number)
  switch (type) {
    case "major":
      return `${parts[0] + 1}.0.0`
    case "minor":
      return `${parts[0]}.${parts[1] + 1}.0`
    case "patch":
      return `${parts[0]}.${parts[1]}.${parts[2] + 1}`
  }
}

const newVersion = bumpVersion(currentVersion, bumpType)
// eslint-disable-next-line no-console
console.log(`[release] New version: ${newVersion}`)

if (dryRun) {
  // eslint-disable-next-line no-console
  console.log(`[release] DRY RUN - Would update package.json to version ${newVersion}`)
  // eslint-disable-next-line no-console
  console.log(`[release] DRY RUN - Would update CHANGELOG.md with [${newVersion}] section`)
  if (!noTag) {
    // eslint-disable-next-line no-console
    console.log(`[release] DRY RUN - Would create git tag claxedo-v${newVersion}`)
  }
  process.exit(0)
}

// Step 3: Update package.json
packageJson.version = newVersion
await Bun.write(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n")
// eslint-disable-next-line no-console
console.log(`[release] Updated package.json`)

// Step 4: Update CHANGELOG.md
const changelogPath = `${claxedoAppDir}/CHANGELOG.md`
const changelogExists = await file(changelogPath).exists()

if (changelogExists) {
  const changelog = await file(changelogPath).text()
  const today = new Date().toISOString().split("T")[0]
  const newEntry = `## [${newVersion}] - ${today}\n\n### Added\n\n### Changed\n\n### Fixed\n\n`

  // Insert new version after [Unreleased] section
  const updatedChangelog = changelog.replace(
    /## \[Unreleased\]\n/,
    `## [Unreleased]\n\n${newEntry}`,
  )

  await Bun.write(changelogPath, updatedChangelog)
  // eslint-disable-next-line no-console
  console.log(`[release] Updated CHANGELOG.md`)
} else {
  // eslint-disable-next-line no-console
  console.log(`[release] CHANGELOG.md not found, skipping`)
}

// Step 5: Git operations
// eslint-disable-next-line no-console
console.log(`[release] Staging changes...`)
await $`git add ${packageJsonPath} ${changelogPath}`.cwd(claxedoAppDir).nothrow()

// eslint-disable-next-line no-console
console.log(`[release] Creating commit...`)
await $`git commit -m "chore(claxedo-app): release v${newVersion}"`.cwd(claxedoAppDir).nothrow()

if (!noTag) {
  // eslint-disable-next-line no-console
  console.log(`[release] Creating tag claxedo-v${newVersion}...`)
  await $`git tag -a claxedo-v${newVersion} -m "Claxedo App v${newVersion}"`.cwd(claxedoAppDir).nothrow()
}

// eslint-disable-next-line no-console
console.log(`[release] Release v${newVersion} complete!`)
// eslint-disable-next-line no-console
console.log(``)
// eslint-disable-next-line no-console
console.log(`Next steps:`)
// eslint-disable-next-line no-console
console.log(`  1. Review the changes: git show HEAD`)
// eslint-disable-next-line no-console
console.log(`  2. Push to remote: git push && git push --tags`)
// eslint-disable-next-line no-console
console.log(`  3. GitHub Actions will automatically build and create release`)
