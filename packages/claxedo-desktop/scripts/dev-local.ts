#!/usr/bin/env bun
/**
 * Claxedo Desktop Dev (Local Mode)
 *
 * Runs the desktop app with a locally patched OpenCode server.
 * This is useful for testing agent hooks and other backend patches.
 *
 * What this does:
 * 1. Patches and runs OpenCode server locally (with agent hooks)
 * 2. Starts Vite dev server with Claxedo overrides
 * 3. Launches Tauri in dev mode WITHOUT the sidecar
 *
 * Usage:
 *   bun run dev:local              # Normal mode
 *   bun run dev:local --debug      # Debug mode (verbose logging)
 *   CLAXEDO_DEBUG=1 bun run dev:local  # Alternative debug mode
 */

import { $ } from "bun"
import * as fs from "fs"
import * as path from "path"
import { tmpdir } from "os"

// Parse command line args
const args = process.argv.slice(2)
const debugMode = args.includes("--debug") || process.env.CLAXEDO_DEBUG === "1"

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname)
const CLAXEDO_DESKTOP_DIR = path.resolve(SCRIPT_DIR, "..")
const CLAXEDO_APP_DIR = path.resolve(CLAXEDO_DESKTOP_DIR, "../claxedo-app")
const DESKTOP_DIR = path.resolve(CLAXEDO_DESKTOP_DIR, "../desktop")
const OPENCODE_DIR = path.resolve(CLAXEDO_APP_DIR, "../opencode")
const PATCHES_DIR = path.resolve(CLAXEDO_APP_DIR, "src/opencode-patches")

function log(message: string, ...extra: any[]) {
  console.log(`[claxedo-desktop-local] ${message}`, ...extra)
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
      if (entry.name === "node_modules" || entry.name === "dist") continue
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
  if (!fs.existsSync(PATCHES_DIR)) return

  async function overlayDir(patchDir: string, targetBase: string) {
    const entries = await fs.promises.readdir(patchDir, { withFileTypes: true })
    for (const entry of entries) {
      const patchPath = path.join(patchDir, entry.name)
      const targetPath = path.join(targetBase, entry.name)
      if (entry.isDirectory()) {
        await fs.promises.mkdir(targetPath, { recursive: true })
        await overlayDir(patchPath, targetPath)
      } else {
        await fs.promises.copyFile(patchPath, targetPath)
      }
    }
  }

  await overlayDir(PATCHES_DIR, path.join(targetDir, "src"))
}

/**
 * Find an available port
 */
function findPort(start: number): number | undefined {
  for (const port of Array.from({ length: 25 }, (_, i) => start + i)) {
    try {
      const server = Bun.serve({
        port,
        fetch() {
          return new Response("ok")
        },
      })
      server.stop(true)
      return port
    } catch {
      // Port in use
    }
  }
}

/**
 * Wait for a server to be ready
 */
async function waitForServer(url: string, maxAttempts = 60): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url)
      if (res.ok) return true
    } catch {
      // Not ready yet
    }
    await Bun.sleep(500)
  }
  return false
}

async function main() {
  log("Starting Claxedo Desktop (Local Mode)")
  log("======================================")

  // Find ports
  const opencodePort = findPort(4096)
  const vitePort = findPort(1420)

  if (!opencodePort || !vitePort) {
    console.error("Could not find available ports")
    process.exit(1)
  }

  log(`OpenCode port: ${opencodePort}`)
  log(`Vite port: ${vitePort}`)

  // Create temp directory for patched opencode
  const tempDir = path.join(tmpdir(), `claxedo-opencode-dev-${Date.now()}`)
  log(`Temp directory: ${tempDir}`)

  // Track all spawned processes
  const processes: ReturnType<typeof Bun.spawn>[] = []

  const cleanup = () => {
    log("Cleaning up...")
    for (const proc of processes) {
      try {
        proc.kill()
      } catch {}
    }
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
    // Step 1: Prepare patched opencode
    log("Preparing patched OpenCode...")
    await copyDir(OPENCODE_DIR, tempDir)
    await applyPatches(tempDir)

    // Symlink node_modules
    const sourceNodeModules = path.join(OPENCODE_DIR, "node_modules")
    const targetNodeModules = path.join(tempDir, "node_modules")
    if (fs.existsSync(sourceNodeModules)) {
      await fs.promises.symlink(sourceNodeModules, targetNodeModules)
    } else {
      log("Installing opencode dependencies...")
      await $`bun install`.cwd(tempDir)
    }

    // Step 2: Start OpenCode server
    if (debugMode) {
      log("Debug mode enabled - verbose agent hooks logging active")
    }
    log("Starting patched OpenCode server...")
    const opencodeProc = Bun.spawn({
      cmd: ["bun", "run", "src/index.ts", "serve", "--port", String(opencodePort)],
      cwd: tempDir,
      env: {
        ...process.env,
        CLAXEDO_PORT: String(opencodePort),
        // Enable debug logging if requested
        ...(debugMode ? { CLAXEDO_DEBUG: "1" } : {}),
      },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })
    processes.push(opencodeProc)

    // Wait for OpenCode to be ready
    const opencodeReady = await waitForServer(`http://127.0.0.1:${opencodePort}/global/health`)
    if (!opencodeReady) {
      console.error("OpenCode server failed to start")
      cleanup()
      process.exit(1)
    }
    log("OpenCode server ready!")

    // Step 3: Start Vite
    log("Starting Vite dev server...")
    const viteProc = Bun.spawn({
      cmd: ["bun", "run", "vite", "--config", "vite.cloud.config.ts", "--port", String(vitePort)],
      cwd: CLAXEDO_APP_DIR,
      env: {
        ...process.env,
        CLAXEDO_OVERRIDES: "1",
      },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })
    processes.push(viteProc)

    // Wait for Vite to be ready
    const viteReady = await waitForServer(`http://127.0.0.1:${vitePort}`)
    if (!viteReady) {
      console.error("Vite server failed to start")
      cleanup()
      process.exit(1)
    }
    log("Vite server ready!")

    // Step 4: Start Tauri (no sidecar - we're running opencode ourselves)
    log("Starting Tauri...")

    // Read the Claxedo branding overlay
    const brandingOverlay = JSON.parse(fs.readFileSync(path.join(CLAXEDO_DESKTOP_DIR, "tauri.conf.json"), "utf-8"))

    const tauriConfig = JSON.stringify({
      build: {
        devUrl: `http://127.0.0.1:${vitePort}`,
        beforeDevCommand: "",
      },
      bundle: {
        // Disable sidecar since we're running opencode ourselves
        externalBin: [],
      },
      ...brandingOverlay,
    })

    const tauriProc = Bun.spawn({
      cmd: ["bun", "run", "tauri", "--", "dev", "--config", tauriConfig],
      cwd: DESKTOP_DIR,
      env: {
        ...process.env,
        // Tell the app to connect to our local patched opencode server (skips sidecar)
        CLAXEDO_BACKEND_URL: `http://127.0.0.1:${opencodePort}`,
        OPENCODE_DESKTOP_PORT: String(vitePort),
        TAURI_DEV_HOST: "127.0.0.1",
      },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })
    processes.push(tauriProc)

    log("")
    log("All services running!")
    log(`  OpenCode: http://127.0.0.1:${opencodePort}`)
    log(`  Vite:     http://127.0.0.1:${vitePort}`)
    if (debugMode) {
      log("")
      log("DEBUG MODE ACTIVE:")
      log("  - Shell scripts log to: ~/.claxedo/debug.log")
      log("  - Watch with: tail -f ~/.claxedo/debug.log")
      log("  - Backend: Look for [agent-hook] logs in console")
      log("  - Frontend: Run in browser console:")
      log('      localStorage.setItem("claxedo.debug.agent-hooks", "1")')
    } else {
      log("")
      log("TIP: Run with --debug flag for verbose agent hooks logging")
    }
    log("")
    log("Press Ctrl+C to stop all services.")

    // Wait for Tauri to exit
    const exitCode = await tauriProc.exited
    cleanup()
    process.exit(exitCode)
  } catch (error) {
    console.error("Error:", error)
    cleanup()
    process.exit(1)
  }
}

main().catch((err) => {
  console.error("Desktop dev failed:", err)
  process.exit(1)
})
