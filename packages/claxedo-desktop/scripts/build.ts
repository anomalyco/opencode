#!/usr/bin/env bun
/**
 * Claxedo Desktop Build Script
 *
 * This script builds the Claxedo desktop app by:
 * 1. Building the patched OpenCode sidecar with agent hooks
 * 2. Building the frontend with Vite using the override system
 * 3. Running Tauri build with custom config to use our built frontend
 *
 * Usage:
 *   bun ./scripts/build.ts [options]
 *
 * Options:
 *   --prod              Production build (uses tauri.prod.conf.json)
 *   --platform=<p>      Target platform: macos, windows, linux, all (default: current)
 *   --target=<t>        Target architecture: x64, arm64, universal (macOS only)
 *   --sign              Enable code signing (requires certificates)
 *   --debug             Build with debug symbols
 *   --verbose           Verbose output
 *   --skip-sidecar      Skip building the patched sidecar (use existing)
 *
 * Examples:
 *   bun ./scripts/build.ts                        # Dev build for current platform
 *   bun ./scripts/build.ts --prod                 # Production build
 *   bun ./scripts/build.ts --platform=macos --target=universal
 *   bun ./scripts/build.ts --prod --sign
 */

import { file, Glob } from "bun"
import { $ } from "bun"
import * as fs from "fs"
import * as path from "path"

// Parse arguments
const args = Bun.argv.slice(2)
const isProd = args.includes("--prod")
const shouldSign = args.includes("--sign")
const isDebug = args.includes("--debug")
const isVerbose = args.includes("--verbose")
const skipSidecar = args.includes("--skip-sidecar")

const platformArg = args.find((arg) => arg.startsWith("--platform="))
const targetArg = args.find((arg) => arg.startsWith("--target="))

const platform = platformArg?.split("=")[1] || "current"
const target = targetArg?.split("=")[1]

const SCRIPT_DIR = import.meta.dir
const CLAXEDO_DESKTOP_DIR = path.resolve(SCRIPT_DIR, "..")
const CLAXEDO_APP_DIR = path.resolve(CLAXEDO_DESKTOP_DIR, "../claxedo-app")
const DESKTOP_DIR = path.resolve(CLAXEDO_DESKTOP_DIR, "../desktop")

// Sidecar binary mappings (same as packages/desktop/scripts/utils.ts)
const SIDECAR_BINARIES: Array<{ rustTarget: string; ocBinary: string }> = [
  { rustTarget: "aarch64-apple-darwin", ocBinary: "opencode-darwin-arm64" },
  { rustTarget: "x86_64-apple-darwin", ocBinary: "opencode-darwin-x64" },
  { rustTarget: "x86_64-pc-windows-msvc", ocBinary: "opencode-windows-x64" },
  { rustTarget: "x86_64-pc-windows-gnu", ocBinary: "opencode-windows-x64" },
  { rustTarget: "x86_64-unknown-linux-gnu", ocBinary: "opencode-linux-x64" },
  { rustTarget: "aarch64-unknown-linux-gnu", ocBinary: "opencode-linux-arm64" },
]

function getRustTarget(): string {
  // Determine rust target based on current platform or specified target
  // On Windows, detect whether MSVC or GNU toolchain is active
  if (process.platform === "darwin") {
    if (process.arch === "arm64") return "aarch64-apple-darwin"
    return "x86_64-apple-darwin"
  } else if (process.platform === "win32") {
    try {
      const rustcOutput = Bun.spawnSync({ cmd: ["rustc", "-vV"] })
      const output = new TextDecoder().decode(rustcOutput.stdout)
      const hostMatch = output.match(/host:\s*(\S+)/)
      if (hostMatch?.[1]) return hostMatch[1]
    } catch {}
    return "x86_64-pc-windows-msvc"
  } else {
    if (process.arch === "arm64") return "aarch64-unknown-linux-gnu"
    return "x86_64-unknown-linux-gnu"
  }
}

function getSidecarConfig(rustTarget: string) {
  const config = SIDECAR_BINARIES.find((b) => b.rustTarget === rustTarget)
  if (!config) throw new Error(`No sidecar config for ${rustTarget}`)
  return config
}

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

// eslint-disable-next-line no-console
console.log(`[claxedo] Building Claxedo desktop app...`)
// eslint-disable-next-line no-console
console.log(`[claxedo] Mode: ${isProd ? "production" : "development"}`)
// eslint-disable-next-line no-console
console.log(`[claxedo] Platform: ${platform}`)
if (target) {
  // eslint-disable-next-line no-console
  console.log(`[claxedo] Target: ${target}`)
}
if (shouldSign) {
  // eslint-disable-next-line no-console
  console.log(`[claxedo] Code signing: enabled`)
}
// eslint-disable-next-line no-console
console.log(``)

// Step 1: Build patched OpenCode sidecar
if (!skipSidecar) {
  // eslint-disable-next-line no-console
  console.log(`[claxedo] Step 1: Building patched OpenCode sidecar...`)

  const rustTarget = getRustTarget()
  const sidecarConfig = getSidecarConfig(rustTarget)
  // eslint-disable-next-line no-console
  console.log(`[claxedo] Target: ${rustTarget} (${sidecarConfig.ocBinary})`)

  // Build patched opencode
  const buildOpencode = await $`bun run ./scripts/build-opencode.ts --single`.cwd(CLAXEDO_APP_DIR).nothrow()

  if (buildOpencode.exitCode !== 0) {
    // eslint-disable-next-line no-console
    console.error(`[claxedo] Patched OpenCode build failed with exit code ${buildOpencode.exitCode}`)
    process.exit(buildOpencode.exitCode)
  }

  // Copy the built binary to the sidecar location
  const distOpencode = path.join(CLAXEDO_APP_DIR, "dist-opencode")
  const sourceBinary = path.join(
    distOpencode,
    sidecarConfig.ocBinary,
    "bin",
    `opencode${process.platform === "win32" ? ".exe" : ""}`,
  )
  const sidecarDir = path.join(DESKTOP_DIR, "src-tauri/sidecars")
  const destBinary = path.join(sidecarDir, `opencode-cli-${rustTarget}${process.platform === "win32" ? ".exe" : ""}`)

  // Check if source exists
  if (!fs.existsSync(sourceBinary)) {
    // eslint-disable-next-line no-console
    console.error(`[claxedo] Built binary not found at ${sourceBinary}`)
    process.exit(1)
  }

  // Create sidecar directory and copy binary
  await fs.promises.mkdir(sidecarDir, { recursive: true })
  await fs.promises.copyFile(sourceBinary, destBinary)
  await fs.promises.chmod(destBinary, 0o755)

  // On Windows, Tauri's bundler may look for a different target triple than the active Rust toolchain.
  // Copy sidecar to both GNU and MSVC target names to cover both cases.
  if (process.platform === "win32") {
    const altTargets = ["x86_64-pc-windows-msvc", "x86_64-pc-windows-gnu"].filter((t) => t !== rustTarget)
    for (const alt of altTargets) {
      const altDest = path.join(sidecarDir, `opencode-cli-${alt}.exe`)
      await fs.promises.copyFile(sourceBinary, altDest)
      // eslint-disable-next-line no-console
      console.log(`[claxedo] Also copied sidecar to ${altDest}`)
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[claxedo] Sidecar copied to ${destBinary}`)
} else {
  // eslint-disable-next-line no-console
  console.log(`[claxedo] Step 1: Skipping sidecar build (--skip-sidecar)`)
}

// Step 2: Build frontend with Vite
// eslint-disable-next-line no-console
console.log(`[claxedo] Step 2: Building frontend with Vite...`)

const viteBuild = await $`bunx vite build --config vite.desktop.config.ts`
  .cwd(CLAXEDO_APP_DIR)
  .env({
    ...Bun.env,
    CLAXEDO_OVERRIDES: "1",
  })
  .nothrow()

if (viteBuild.exitCode !== 0) {
  // eslint-disable-next-line no-console
  console.error(`[claxedo] Vite build failed with exit code ${viteBuild.exitCode}`)
  process.exit(viteBuild.exitCode)
}

// eslint-disable-next-line no-console
console.log(`[claxedo] Frontend built to dist-desktop/`)

// Step 3: Clean up any leftover DMG mounts and temp files from previous builds
// eslint-disable-next-line no-console
console.log(`[claxedo] Step 3: Cleaning up previous build artifacts...`)

const buildProfile = isDebug ? "debug" : "release"
const tauriTargetDir = path.join(DESKTOP_DIR, `src-tauri/target/${buildProfile}`)
const bundleMacosDir = path.join(tauriTargetDir, "bundle/macos")

// Unmount any leftover DMG images from failed builds
const hdiutilInfo = await $`hdiutil info 2>/dev/null`.nothrow().text()
const dmgMatches = hdiutilInfo.match(/\/dev\/disk\d+(?=.*rw\.\d+\..*\.dmg)/g)
if (dmgMatches) {
  for (const disk of dmgMatches) {
    // eslint-disable-next-line no-console
    console.log(`[claxedo] Unmounting leftover DMG: ${disk}`)
    await $`hdiutil detach ${disk} 2>/dev/null || hdiutil detach -force ${disk} 2>/dev/null`.nothrow()
  }
}

// Remove leftover temp DMG files (use bash to handle glob expansion gracefully)
await $`bash -c ${"rm -f " + bundleMacosDir + "/rw.*.dmg 2>/dev/null || true"}`.nothrow()

// Step 4: Clean Tauri build cache to force re-embedding frontend assets
// Cargo's incremental compilation doesn't track frontend file changes,
// so we need to clean the build artifacts that embed the frontend.
// eslint-disable-next-line no-console
console.log(`[claxedo] Step 4: Cleaning Tauri build cache...`)

// Clean build artifacts for opencode-desktop and tauri crates (which embed frontend)
// Use bash to handle glob expansion gracefully when no matches exist
const cleanCmd = `rm -rf ${tauriTargetDir}/build/opencode-desktop-* ${tauriTargetDir}/build/tauri-* ${tauriTargetDir}/.fingerprint/opencode-desktop-* ${tauriTargetDir}/.fingerprint/tauri-* 2>/dev/null || true`
await $`bash -c ${cleanCmd}`.nothrow()
// eslint-disable-next-line no-console
console.log(`[claxedo] Build cache cleaned`)

// Step 5: Run Tauri build with config override
// eslint-disable-next-line no-console
console.log(`[claxedo] Step 5: Running Tauri build...`)

// Set up signing environment variables
const buildEnv = { ...Bun.env }

if (shouldSign) {
  // macOS signing
  if (platform === "macos" || process.platform === "darwin") {
    if (!buildEnv.APPLE_SIGNING_IDENTITY) {
      // eslint-disable-next-line no-console
      console.warn(`[claxedo] APPLE_SIGNING_IDENTITY not set, signing may fail`)
    }
  }

  // Windows signing
  if (platform === "windows" || process.platform === "win32") {
    if (!buildEnv.TAURI_SIGNING_PRIVATE_KEY) {
      // eslint-disable-next-line no-console
      console.warn(`[claxedo] TAURI_SIGNING_PRIVATE_KEY not set, signing may fail`)
    }
  }
}

// Read branding overlay configs
const devBrandingOverlay = JSON.parse(fs.readFileSync(path.join(CLAXEDO_DESKTOP_DIR, "tauri.conf.json"), "utf-8"))
const prodBrandingOverlay = isProd
  ? JSON.parse(fs.readFileSync(path.join(CLAXEDO_DESKTOP_DIR, "tauri.prod.conf.json"), "utf-8"))
  : {}

// Override Tauri config to use our built frontend + Claxedo branding
// Path is relative to src-tauri directory
const tauriConfigOverride: Record<string, unknown> = {
  build: {
    beforeBuildCommand: "", // Skip Tauri's default build command (we already built)
    frontendDist: "../../claxedo-app/dist-desktop",
  },
  // Merge branding: prod overlay takes precedence over dev overlay
  ...devBrandingOverlay,
  ...(isProd ? prodBrandingOverlay : {}),
}

// When skipping sidecar, override externalBin to empty so Tauri doesn't expect it
if (skipSidecar) {
  const bundle = (tauriConfigOverride.bundle as Record<string, unknown>) || {}
  bundle.externalBin = []
  tauriConfigOverride.bundle = bundle
}

// Add updater config for production builds
if (isProd) {
  const pubkey = buildEnv.TAURI_SIGNING_PUBLIC_KEY || buildEnv.CLAXEDO_UPDATER_PUBKEY
  const endpoint = buildEnv.CLAXEDO_UPDATER_ENDPOINT
  if (pubkey || endpoint) {
    tauriConfigOverride.plugins = {
      ...((tauriConfigOverride.plugins as Record<string, unknown>) || {}),
      updater: {
        ...(pubkey ? { pubkey } : {}),
        ...(endpoint ? { endpoints: [endpoint] } : {}),
      },
    }
  } else {
    // CLAXEDO PATCH: If no updater keys are present, do NOT try to configure the updater plugin.
    // This prevents the "failed to get updater configuration: plugins > updater doesn't exist" error
    // when building locally without updater credentials.
    // We also need to disable createUpdaterArtifacts if it was enabled in prod config
    if (tauriConfigOverride.bundle && typeof tauriConfigOverride.bundle === "object") {
      // @ts-ignore
      tauriConfigOverride.bundle.createUpdaterArtifacts = false
      // @ts-ignore
      tauriConfigOverride.bundle.macOS = { ...tauriConfigOverride.bundle.macOS, signingIdentity: null }
    }
  }
}

// Disable signing identity if user didn't ask for signing
// This prevents Tauri from failing if it tries to auto-sign but no identity is found
if (!shouldSign && tauriConfigOverride.bundle && typeof tauriConfigOverride.bundle === "object") {
  // @ts-ignore
  if (tauriConfigOverride.bundle.macOS) {
    // @ts-ignore
    tauriConfigOverride.bundle.macOS.signingIdentity = null
  }
}

const tauriArgs = ["tauri", "--", "build", "--config", JSON.stringify(tauriConfigOverride)]

// Add target-specific args
if (target) {
  switch (target) {
    case "x64":
      if (platform === "macos" || process.platform === "darwin") {
        tauriArgs.push("--target", "x86_64-apple-darwin")
      } else if (platform === "windows" || process.platform === "win32") {
        tauriArgs.push("--target", "x86_64-pc-windows-msvc")
      } else {
        tauriArgs.push("--target", "x86_64-unknown-linux-gnu")
      }
      break
    case "arm64":
      if (platform === "macos" || process.platform === "darwin") {
        tauriArgs.push("--target", "aarch64-apple-darwin")
      } else if (platform === "windows" || process.platform === "win32") {
        tauriArgs.push("--target", "aarch64-pc-windows-msvc")
      } else {
        tauriArgs.push("--target", "aarch64-unknown-linux-gnu")
      }
      break
    case "universal":
      if (platform === "macos" || process.platform === "darwin") {
        tauriArgs.push("--target", "universal-apple-darwin")
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[claxedo] Universal target only supported on macOS`)
      }
      break
  }
}

// Add debug flag
if (isDebug) {
  tauriArgs.push("--debug")
}

// Add verbose flag
if (isVerbose) {
  tauriArgs.push("--verbose")
}

const tauriBuild = await $`bun run ${tauriArgs}`.cwd(DESKTOP_DIR).env(buildEnv).nothrow()

if (tauriBuild.exitCode !== 0) {
  // eslint-disable-next-line no-console
  console.error(`[claxedo] Tauri build failed with exit code ${tauriBuild.exitCode}`)
  process.exit(tauriBuild.exitCode)
}

// eslint-disable-next-line no-console
console.log(``)
// eslint-disable-next-line no-console
console.log(`[claxedo] Desktop build complete!`)
// eslint-disable-next-line no-console
console.log(`[claxedo] Output: ${DESKTOP_DIR}/src-tauri/target/release/bundle/`)

// List built artifacts
// eslint-disable-next-line no-console
console.log(``)
// eslint-disable-next-line no-console
console.log(`[claxedo] Built artifacts:`)

const bundlePath = path.join(DESKTOP_DIR, "src-tauri/target/release/bundle")
const listArtifacts = await $`ls -la ${bundlePath}`.nothrow()
if (listArtifacts.exitCode === 0) {
  // Show built artifacts using Bun's Glob (avoids shell escaping issues)
  const artifactGlob = new Glob("**/*.{dmg,app,exe,msi,deb,rpm,AppImage}")
  const artifacts: string[] = []
  for await (const artifact of artifactGlob.scan({ cwd: bundlePath, onlyFiles: false })) {
    artifacts.push(artifact)
  }
  if (artifacts.length > 0) {
    // eslint-disable-next-line no-console
    console.log(artifacts.join("\n"))
  }
}
