#!/usr/bin/env bun
/**
 * dev-watch — Hot-reload wrapper for ZERO development.
 *
 * Spawns `bun dev` (the TUI) as a child process and monitors the
 * packages/core/src/ and packages/opencode/src/ directories for
 * file changes.  On any change the child is killed and respawned
 * so that source edits take effect immediately.
 *
 * Usage:
 *   bun run scripts/dev-watch.ts
 *
 * The parent process responds to SIGINT / SIGTERM by shutting
 * down the child cleanly and exiting.
 */

import { spawn, type ChildProcess } from "node:child_process"
import { watch } from "node:fs/promises"
import path from "node:path"
import fs from "node:fs"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..")
const WATCH_DIRS = [
  path.join(REPO_ROOT, "packages", "core", "src"),
  path.join(REPO_ROOT, "packages", "opencode", "src"),
]
const DEV_CWD = path.join(REPO_ROOT, "packages", "opencode")

// Reduce noise by ignoring common generated paths
const IGNORE_PATTERNS = [
  /node_modules/,
  /\.git/,
  /dist\//,
  /build\//,
  /\.cache/,
]

const POLL_MS = 1_500 // Polling interval (ms) for mtime checks

// ---------------------------------------------------------------------------
// Debounce
// ---------------------------------------------------------------------------

let restartTimer: ReturnType<typeof setTimeout> | null = null
const DEBOUNCE_MS = 500

function scheduleRestart(spawner: () => void) {
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restartTimer = null
    spawner()
  }, DEBOUNCE_MS)
}

// ---------------------------------------------------------------------------
// Child process management
// ---------------------------------------------------------------------------

let child: ChildProcess | null = null

function startChild(): void {
  if (child) killChild()

  console.log(`\n[dev-watch] Starting bun dev in ${DEV_CWD} ...`)
  child = spawn("bun", ["run", "--conditions=browser", "./src/index.ts"], {
    cwd: DEV_CWD,
    stdio: "inherit",
    env: { ...process.env },
  })

  child.on("exit", (code, signal) => {
    // If we didn't initiate the kill, log it
    if (signal !== "SIGTERM") {
      console.log(`[dev-watch] Child exited (code=${code}, signal=${signal})`)
    }
  })

  child.on("error", (err) => {
    console.error("[dev-watch] Failed to start child:", err.message)
  })
}

function killChild(): void {
  if (!child) return
  try {
    child.kill("SIGTERM")
  } catch { /* ignore */ }
  child = null
}

// ---------------------------------------------------------------------------
// File change detection via mtime polling
// ---------------------------------------------------------------------------

interface DirCache {
  [filePath: string]: number // mtimeMs
}

let caches: DirCache[] = []

function scanDirs(): DirCache[] {
  return WATCH_DIRS.map((dirPath) => {
    const cache: DirCache = {}
    try {
      walkDir(dirPath, cache, dirPath)
    } catch { /* ignore unreadable dirs */ }
    return cache
  })
}

function walkDir(dir: string, cache: DirCache, root: string): void {
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const full = path.join(dir, name)
    if (IGNORE_PATTERNS.some((p) => p.test(full))) continue
    try {
      const stat = fs.statSync(full)
      if (stat.isDirectory()) {
        walkDir(full, cache, root)
      } else {
        cache[full] = stat.mtimeMs
      }
    } catch { /* skip unreadable */ }
  }
}

function detectChanges(previous: DirCache[], current: DirCache[]): string[] {
  const changed: string[] = []
  for (let i = 0; i < previous.length; i++) {
    const prev = previous[i]
    const curr = current[i]
    if (!curr) continue
    for (const [filePath, mtime] of Object.entries(curr)) {
      if (prev[filePath] !== mtime) {
        changed.push(filePath)
      }
    }
  }
  return changed
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function main() {
  console.log("[dev-watch] Starting ZERO with hot reload ...")
  console.log(`[dev-watch] Watching:`)
  for (const dir of WATCH_DIRS) {
    console.log(`  - ${dir}`)
  }
  console.log(`[dev-watch] Poll interval: ${POLL_MS}ms, debounce: ${DEBOUNCE_MS}ms`)
  console.log("")

  // Initial scan
  caches = scanDirs()
  startChild()

  // Poll loop
  const poll = async () => {
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      const fresh = scanDirs()
      const changed = detectChanges(caches, fresh)
      if (changed.length > 0) {
        for (const file of changed.slice(0, 5)) {
          console.log(`[dev-watch] Changed: ${path.relative(REPO_ROOT, file)}`)
        }
        if (changed.length > 5) {
          console.log(`[dev-watch]   ... and ${changed.length - 5} more`)
        }
        caches = fresh
        scheduleRestart(startChild)
      }
      caches = fresh
    }
  }

  // Handle signals
  const shutdown = () => {
    console.log("\n[dev-watch] Shutting down ...")
    killChild()
    process.exit(0)
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  // Start polling
  await poll()
}

main().catch((err) => {
  console.error("[dev-watch] Fatal error:", err)
  killChild()
  process.exit(1)
})
