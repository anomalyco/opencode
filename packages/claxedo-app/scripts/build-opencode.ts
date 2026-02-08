#!/usr/bin/env bun
/**
 * Claxedo OpenCode Build Script
 *
 * This script builds a patched version of OpenCode with Claxedo-specific
 * modifications (agent hooks, etc.) while keeping upstream pristine.
 *
 * Process:
 * 1. Apply patches to packages/opencode/src in-place
 * 2. Run the standard opencode build (uses monorepo's node_modules)
 * 3. Copy output to dist-opencode/
 * 4. Restore original files via git checkout
 */

import { $ } from "bun"
import * as fs from "fs"
import * as path from "path"

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname)
const CLAXEDO_APP_DIR = path.resolve(SCRIPT_DIR, "..")
const OPENCODE_DIR = path.resolve(CLAXEDO_APP_DIR, "../opencode")
const PATCHES_DIR = path.resolve(CLAXEDO_APP_DIR, "src/opencode-patches")
const OUTPUT_DIR = path.resolve(CLAXEDO_APP_DIR, "dist-opencode")

// Parse command line args
const args = process.argv.slice(2)
const singleFlag = args.includes("--single")
const baselineFlag = args.includes("--baseline")
const verbose = args.includes("--verbose")

function log(message: string, ...extra: any[]) {
  console.log(`[claxedo-opencode] ${message}`, ...extra)
}

function debug(message: string, ...extra: any[]) {
  if (verbose) {
    console.log(`[claxedo-opencode:debug] ${message}`, ...extra)
  }
}

/**
 * Recursively copy directory
 */
async function copyDir(src: string, dest: string) {
  await fs.promises.mkdir(dest, { recursive: true })
  const entries = await fs.promises.readdir(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      // Skip node_modules and dist
      if (entry.name === "node_modules" || entry.name === "dist") {
        continue
      }
      await copyDir(srcPath, destPath)
    } else {
      await fs.promises.copyFile(srcPath, destPath)
    }
  }
}

/**
 * Apply patches by overlaying files, returns list of patched file paths (relative to opencode/src)
 */
async function applyPatches(): Promise<string[]> {
  if (!fs.existsSync(PATCHES_DIR)) {
    log("No patches directory found, skipping")
    return []
  }

  log("Applying patches from", PATCHES_DIR)
  const patchedFiles: string[] = []

  async function overlayDir(patchDir: string, targetBase: string, relPath: string = "") {
    const entries = await fs.promises.readdir(patchDir, { withFileTypes: true })

    for (const entry of entries) {
      const patchPath = path.join(patchDir, entry.name)
      const targetPath = path.join(targetBase, entry.name)
      const relativePath = path.join(relPath, entry.name)

      if (entry.isDirectory()) {
        await fs.promises.mkdir(targetPath, { recursive: true })
        await overlayDir(patchPath, targetPath, relativePath)
      } else {
        debug(`  Patching: ${relativePath}`)
        await fs.promises.copyFile(patchPath, targetPath)
        patchedFiles.push(relativePath)
      }
    }
  }

  const targetSrcDir = path.join(OPENCODE_DIR, "src")
  await overlayDir(PATCHES_DIR, targetSrcDir)
  return patchedFiles
}

/**
 * Restore patched files using git checkout
 */
async function restoreFiles(patchedFiles: string[]) {
  if (patchedFiles.length === 0) return

  log("Restoring original files...")
  for (const relPath of patchedFiles) {
    const fullPath = path.join("src", relPath)
    debug(`  Restoring: ${fullPath}`)
    await $`git checkout -- ${fullPath}`.cwd(OPENCODE_DIR).nothrow()
  }
}

/**
 * List all patch files for verification
 */
async function listPatches(): Promise<string[]> {
  const patches: string[] = []

  async function walkDir(dir: string) {
    if (!fs.existsSync(dir)) return
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walkDir(fullPath)
      } else {
        patches.push(path.relative(PATCHES_DIR, fullPath))
      }
    }
  }

  await walkDir(PATCHES_DIR)
  return patches
}

async function main() {
  log("Building Claxedo-patched OpenCode")
  log("================================")

  // Show patches
  const patches = await listPatches()
  if (patches.length > 0) {
    log(`Found ${patches.length} patch file(s):`)
    for (const patch of patches) {
      log(`  - ${patch}`)
    }
  } else {
    log("No patches found - building vanilla OpenCode")
  }

  // Check for uncommitted changes in opencode/src that would be overwritten
  const gitStatus = await $`git status --porcelain src/`.cwd(OPENCODE_DIR).text()
  if (gitStatus.trim()) {
    log("Warning: Uncommitted changes in packages/opencode/src/")
    log("These files will be temporarily modified and then restored:")
    log(gitStatus)
  }

  let patchedFiles: string[] = []

  try {
    // Step 1: Apply patches in-place
    log("Applying Claxedo patches to packages/opencode/src...")
    patchedFiles = await applyPatches()

    // Step 2: Run build from opencode directory (uses monorepo node_modules)
    log("Running build...")
    const buildArgs: string[] = []
    if (singleFlag) buildArgs.push("--single")
    if (baselineFlag) buildArgs.push("--baseline")

    await $`bun run script/build.ts ${buildArgs}`.cwd(OPENCODE_DIR)

    // Step 3: Copy output
    const opencodeDistDir = path.join(OPENCODE_DIR, "dist")
    if (fs.existsSync(opencodeDistDir)) {
      log(`Copying build output to ${OUTPUT_DIR}...`)
      await fs.promises.rm(OUTPUT_DIR, { recursive: true, force: true })
      await copyDir(opencodeDistDir, OUTPUT_DIR)
      log("Build complete!")

      // List output
      const outputs = await fs.promises.readdir(OUTPUT_DIR)
      log(`Output packages: ${outputs.join(", ")}`)
    } else {
      log("Warning: No dist directory found after build")
    }
  } finally {
    // Step 4: Always restore original files
    await restoreFiles(patchedFiles)
  }

  log("Done!")
}

main().catch((err) => {
  console.error("Build failed:", err)
  process.exit(1)
})
