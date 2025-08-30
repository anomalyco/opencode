#!/usr/bin/env bun

/**
 * Release script for creating a new version
 * Usage: bun run ./script/release.ts [major|minor|patch]
 */

import { $ } from "bun"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"

const releaseType = process.argv[2] || "patch"

if (!["major", "minor", "patch"].includes(releaseType)) {
  console.error("Invalid release type. Use: major, minor, or patch")
  process.exit(1)
}

async function updateVersion(packagePath: string, newVersion: string) {
  const pkg = JSON.parse(readFileSync(packagePath, "utf-8"))
  pkg.version = newVersion
  writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n")
}

async function main() {
  try {
    // Get current version
    const packagePath = join(process.cwd(), "package.json")
    const pkg = JSON.parse(readFileSync(packagePath, "utf-8"))
    const currentVersion = pkg.version || "0.0.0"
    
    // Calculate new version
    const [major, minor, patch] = currentVersion.split(".").map(Number)
    let newVersion: string
    
    switch (releaseType) {
      case "major":
        newVersion = `${major + 1}.0.0`
        break
      case "minor":
        newVersion = `${major}.${minor + 1}.0`
        break
      case "patch":
        newVersion = `${major}.${minor}.${patch + 1}`
        break
      default:
        throw new Error("Invalid release type")
    }
    
    console.log(`Releasing v${newVersion} (${releaseType} release)...`)
    
    // Update package.json version
    await updateVersion(packagePath, newVersion)
    console.log("✓ Updated package.json")
    
    // Update workspace root package.json if it exists
    const rootPackagePath = join(process.cwd(), "../..", "package.json")
    if (existsSync(rootPackagePath)) {
      const rootPkg = JSON.parse(readFileSync(rootPackagePath, "utf-8"))
      if (!rootPkg.private) {
        await updateVersion(rootPackagePath, newVersion)
        console.log("✓ Updated root package.json")
      }
    }
    
    // Commit changes
    await $`git add -A`
    await $`git commit -m "chore: release v${newVersion}"`
    console.log("✓ Committed changes")
    
    // Check if tag already exists
    try {
      await $`git rev-parse v${newVersion}`.quiet()
      console.error(`✗ Tag v${newVersion} already exists`)
      console.log("Rolling back version change...")
      await updateVersion(packagePath, currentVersion)
      await $`git add -A`
      await $`git commit --amend --no-edit`
      process.exit(1)
    } catch {
      // Tag doesn't exist, create it
      await $`git tag -a v${newVersion} -m "Release v${newVersion}"`
      console.log(`✓ Created tag v${newVersion}`)
    }
    
    console.log("\n✨ Release prepared!")
    console.log("\nTo publish the release:")
    console.log(`  git push origin main`)
    console.log(`  git push origin v${newVersion}`)
    console.log("\nThis will trigger the GitHub Actions workflow to:")
    console.log("  - Build binaries for all platforms")
    console.log("  - Create a GitHub release")
    console.log("  - Publish to npm")
    
  } catch (error) {
    console.error("Release failed:", error)
    process.exit(1)
  }
}

// Check for uncommitted changes
try {
  const gitStatus = await $`git status --porcelain`.text()
  if (gitStatus.trim() && !process.env.FORCE) {
    console.error("Error: You have uncommitted changes. Commit or stash them first.")
    console.error("Use FORCE=true to override this check.")
    process.exit(1)
  }
} catch (error) {
  console.error("Failed to check git status:", error)
  process.exit(1)
}

main()