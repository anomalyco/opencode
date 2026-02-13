#!/usr/bin/env bun
/**
 * Claxedo Desktop Dev Script
 *
 * Runs the Claxedo-branded Tauri desktop app in dev mode:
 * 1. Loads .env.local from claxedo-app
 * 2. Starts Vite with claxedo desktop config
 * 3. Launches Tauri dev with Claxedo branding overlay
 */

import { file } from "bun"
import * as path from "path"
import * as fs from "fs"

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname)
const CLAXEDO_DESKTOP_DIR = path.resolve(SCRIPT_DIR, "..")
const CLAXEDO_APP_DIR = path.resolve(CLAXEDO_DESKTOP_DIR, "../claxedo-app")
const DESKTOP_DIR = path.resolve(CLAXEDO_DESKTOP_DIR, "../desktop")
const CARGO_TOML = path.join(DESKTOP_DIR, "src-tauri", "Cargo.toml")
const CARGO_LOCK = path.join(DESKTOP_DIR, "src-tauri", "Cargo.lock")

// Load .env.local from claxedo-app if it exists
const envLocalPath = path.join(CLAXEDO_APP_DIR, ".env.local")
try {
  const envContent = await file(envLocalPath).text()
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const [key, ...rest] = trimmed.split("=")
    if (key && rest.length > 0) {
      const value = rest.join("=")
      if (!Bun.env[key]) {
        Bun.env[key] = value
      }
    }
  }
} catch {
  // .env.local doesn't exist, that's fine
}

// Get the Claxedo backend URL (defaults to http://127.0.0.1:3000)
const claxedoBackendUrl = Bun.env.VITE_OPENCODE_BACKEND_URL ?? "http://127.0.0.1:4096"

// eslint-disable-next-line no-console
console.log(`[claxedo] Using Claxedo backend: ${claxedoBackendUrl}`)

const base = Number(Bun.env.OPENCODE_DESKTOP_PORT ?? "1420")

const pick = (start: number) => {
  for (const port of Array.from({ length: 25 }, (_, i) => start + i)) {
    const ok = (() => {
      try {
        const server = Bun.serve({
          port,
          fetch() {
            return new Response("ok")
          },
        })
        server.stop(true)
        return true
      } catch {
        return false
      }
    })()

    if (ok) return port
  }
}

const port = pick(base)
if (!port) {
  // eslint-disable-next-line no-console
  console.error(`[claxedo] No free port found in range ${base}-${base + 24} for desktop dev server.`)
  process.exit(1)
}

// eslint-disable-next-line no-console
console.log(`[claxedo] Desktop dev server port: ${port}`)

// Start Vite with claxedo desktop config from claxedo-app directory
// eslint-disable-next-line no-console
console.log(`[claxedo] Starting Vite with desktop config...`)

const viteProc = Bun.spawn({
  cmd: ["bun", "run", "vite", "--config", "vite.desktop.config.ts"],
  cwd: CLAXEDO_APP_DIR,
  env: {
    ...Bun.env,
    CLAXEDO_OVERRIDES: "1",
    OPENCODE_DESKTOP_PORT: String(port),
    TAURI_DEV_HOST: "127.0.0.1",
    VITE_OPENCODE_BACKEND_URL: claxedoBackendUrl,
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

// Wait for Vite to be ready
const waitForVite = async (url: string, maxAttempts = 60) => {
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

const viteReady = await waitForVite(`http://127.0.0.1:${port}`)
if (!viteReady) {
  // eslint-disable-next-line no-console
  console.error(`[claxedo] Vite server failed to start at http://127.0.0.1:${port}`)
  viteProc.kill()
  process.exit(1)
}

// eslint-disable-next-line no-console
console.log(`[claxedo] Vite ready at http://127.0.0.1:${port}`)

// ── Patch Cargo.toml binary name for Claxedo branding ──
// In Tauri dev mode, the dock icon hover text comes from Cargo.toml [package].name.
// We temporarily patch it to "claxedo" and restore on exit.
const origCargoToml = fs.readFileSync(CARGO_TOML, "utf-8")
const origCargoLock = fs.readFileSync(CARGO_LOCK, "utf-8")
const patchedCargoToml = origCargoToml.replace(
  /^name\s*=\s*"opencode-desktop"/m,
  'name = "claxedo"',
)
if (patchedCargoToml === origCargoToml) {
  // eslint-disable-next-line no-console
  console.warn("[claxedo] Warning: Could not find 'name = \"opencode-desktop\"' in Cargo.toml to patch")
} else {
  fs.writeFileSync(CARGO_TOML, patchedCargoToml)
  // eslint-disable-next-line no-console
  console.log("[claxedo] Patched Cargo.toml: name → claxedo")
}

// Read the Claxedo branding overlay
const brandingOverlay = JSON.parse(fs.readFileSync(path.join(CLAXEDO_DESKTOP_DIR, "tauri.conf.json"), "utf-8"))

// Tauri config: merge devUrl + branding overlay
// Disable sidecar — dev.ts connects to an external gateway server instead
const config = JSON.stringify({
  build: {
    devUrl: `http://127.0.0.1:${port}`,
    beforeDevCommand: "", // Skip Tauri's default dev command
  },
  bundle: {
    externalBin: [],
  },
  ...brandingOverlay,
})

const tauriProc = Bun.spawn({
  cmd: ["bun", "run", "tauri", "--", "dev", "--config", config],
  cwd: DESKTOP_DIR,
  env: {
    ...Bun.env,
    OPENCODE_DESKTOP_PORT: String(port),
    TAURI_DEV_HOST: "127.0.0.1",
    CLAXEDO_BACKEND_URL: claxedoBackendUrl,
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

// Handle cleanup — restore patched files
const restoreCargo = () => {
  try {
    fs.writeFileSync(CARGO_TOML, origCargoToml)
    fs.writeFileSync(CARGO_LOCK, origCargoLock)
    // eslint-disable-next-line no-console
    console.log("[claxedo] Restored Cargo.toml and Cargo.lock")
  } catch {
    // eslint-disable-next-line no-console
    console.warn("[claxedo] Warning: Failed to restore Cargo.toml — run: git checkout packages/desktop/src-tauri/Cargo.toml packages/desktop/src-tauri/Cargo.lock")
  }
}

const cleanup = () => {
  viteProc.kill()
  tauriProc.kill()
  restoreCargo()
}

process.on("SIGINT", cleanup)
process.on("SIGTERM", cleanup)

// Wait for Tauri to exit
const exitCode = await tauriProc.exited
cleanup()
process.exit(exitCode)
