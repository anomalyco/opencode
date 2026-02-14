#!/usr/bin/env bun
/**
 * Claxedo OpenCode Dev Script
 *
 * Runs a patched version of OpenCode in dev mode without compiling.
 * Much faster for iteration than building a full binary.
 *
 * Usage:
 *   bun run opencode:dev              # Run patched opencode server
 *   bun run opencode:dev --port 4096  # Specify port
 */

import { $ } from "bun"
import * as fs from "fs"
import * as path from "path"
import { tmpdir } from "os"
import { fileURLToPath } from "url"

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const CLAXEDO_APP_DIR = path.resolve(SCRIPT_DIR, "..")
const OPENCODE_DIR = path.resolve(CLAXEDO_APP_DIR, "../opencode")
const PATCHES_DIR = path.resolve(CLAXEDO_APP_DIR, "src/opencode-patches")

// Parse command line args
const args = process.argv.slice(2)
const portIndex = args.indexOf("--port")
const port = portIndex !== -1 ? args[portIndex + 1] : "4096"
const verbose = args.includes("--verbose")
const debugMode = args.includes("--debug") || process.env.CLAXEDO_DEBUG === "1"

function log(message: string, ...extra: any[]) {
  console.log(`[claxedo-opencode-dev] ${message}`, ...extra)
}

function debug(message: string, ...extra: any[]) {
  if (verbose) {
    console.log(`[claxedo-opencode-dev:debug] ${message}`, ...extra)
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
 * Apply patches by overlaying files
 */
async function applyPatches(targetDir: string) {
  if (!fs.existsSync(PATCHES_DIR)) {
    log("No patches directory found, skipping")
    return
  }

  log("Applying patches from", PATCHES_DIR)

  async function overlayDir(patchDir: string, targetBase: string) {
    const entries = await fs.promises.readdir(patchDir, { withFileTypes: true })

    for (const entry of entries) {
      const patchPath = path.join(patchDir, entry.name)
      const targetPath = path.join(targetBase, entry.name)

      if (entry.isDirectory()) {
        await fs.promises.mkdir(targetPath, { recursive: true })
        await overlayDir(patchPath, targetPath)
      } else {
        debug(`  Patching: ${path.relative(PATCHES_DIR, patchPath)}`)
        await fs.promises.copyFile(patchPath, targetPath)
      }
    }
  }

  await overlayDir(PATCHES_DIR, path.join(targetDir, "src"))
}

/**
 * List all patch files
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
  log("Starting Claxedo-patched OpenCode (dev mode)")
  log("============================================")

  // Show patches
  const patches = await listPatches()
  if (patches.length > 0) {
    log(`Found ${patches.length} patch file(s):`)
    for (const patch of patches) {
      log(`  - ${patch}`)
    }
  } else {
    log("No patches found - running vanilla OpenCode")
  }

  // Create temp directory for patched source
  const tempDir = path.join(tmpdir(), `claxedo-opencode-dev-${Date.now()}`)
  log(`Creating temp directory: ${tempDir}`)

  // Handle cleanup on exit
  const cleanup = () => {
    log("Cleaning up temp directory...")
    fs.rmSync(tempDir, { recursive: true, force: true })
  }

  process.on("SIGINT", () => {
    cleanup()
    process.exit(0)
  })
  process.on("SIGTERM", () => {
    cleanup()
    process.exit(0)
  })

  try {
    // Step 1: Copy opencode source
    log("Copying opencode source...")
    await copyDir(OPENCODE_DIR, tempDir)

    // Step 2: Apply patches
    log("Applying Claxedo patches...")
    await applyPatches(tempDir)

    // Step 3: Create symlink to node_modules (avoid reinstalling)
    const sourceNodeModules = path.join(OPENCODE_DIR, "node_modules")
    const targetNodeModules = path.join(tempDir, "node_modules")
    if (fs.existsSync(sourceNodeModules)) {
      log("Symlinking node_modules...")
      await fs.promises.symlink(sourceNodeModules, targetNodeModules)
    } else {
      log("Installing dependencies...")
      await $`bun install`.cwd(tempDir)
    }

    // Step 4: Run the server
    log(`Starting server on port ${port}...`)
    log("")

    // Run the opencode server directly
    if (debugMode) {
      log("DEBUG MODE ACTIVE:")
      log("  - Shell scripts log to: ~/.claxedo/debug.log")
      log("  - Watch with: tail -f ~/.claxedo/debug.log")
      log("  - Backend: Look for [agent-hook] logs in console")
      log("")
    } else {
      log("TIP: Run with --debug flag for verbose agent hooks logging")
      log("")
    }

    log("Server running! Press Ctrl+C to stop.")
    log("")

    const proc = Bun.spawn({
      cmd: ["bun", "run", "src/index.ts", "serve", "--port", port],
      cwd: tempDir,
      env: {
        ...process.env,
        // Pass through CLAXEDO env vars for the agent hooks
        CLAXEDO_PORT: port,
        // Enable debug logging if requested
        ...(debugMode ? { CLAXEDO_DEBUG: "1" } : {}),
      },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })

    // Wait for process to exit
    const exitCode = await proc.exited
    cleanup()
    process.exit(exitCode)
  } catch (error) {
    cleanup()
    throw error
  }
}

main().catch((err) => {
  console.error("Dev server failed:", err)
  process.exit(1)
})
