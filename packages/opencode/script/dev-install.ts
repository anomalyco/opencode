#!/usr/bin/env bun

/**
 * Development installation script
 * Builds the current dev version and installs it to PATH
 *
 * Usage:
 *   bun script/dev-install.ts
 *
 * Sets version to: dev0.0.1-netdrop-dodged
 */

import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import os from "os"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

// Set environment for dev build with custom version
const env = {
  ...process.env,
  OPENCODE_VERSION: "dev0.0.1-netdrop-dodged",
  OPENCODE_CHANNEL: "local",
}

console.log("🏗️  Building dev version: dev0.0.1-netdrop-dodged")

// Build with --single flag for current platform only
await $`bun run script/build.ts --single`.env(env)

console.log("✅ Build complete")

// Find the built binary
const platform = process.platform === "win32" ? "windows" : process.platform
const arch = process.arch
const binaryName = `opencode-${platform}-${arch}`
const binaryPath = path.join(dir, "dist", binaryName, "bin", process.platform === "win32" ? "opencode.exe" : "opencode")

if (!fs.existsSync(binaryPath)) {
  throw new Error(`Built binary not found at ${binaryPath}`)
}

console.log(`📦 Binary ready at: ${binaryPath}`)

// Determine install location
let installDir: string
if (process.platform === "win32") {
  // On Windows, use %LOCALAPPDATA%\opencode\bin
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
  installDir = path.join(localAppData, "opencode", "bin")
} else {
  // On Unix, use ~/.local/bin
  installDir = path.join(os.homedir(), ".local", "bin")
}

// Create directory if needed
await fs.promises.mkdir(installDir, { recursive: true })

// Copy binary to install location
const installedPath = path.join(installDir, path.basename(binaryPath))
await fs.promises.copyFile(binaryPath, installedPath)

// Make executable on Unix
if (process.platform !== "win32") {
  await $`chmod +x ${installedPath}`
}

console.log(`✨ Installed to: ${installedPath}`)

// Verify it's in PATH
const pathEnv = process.env.PATH || ""
const pathDirs = pathEnv.split(path.delimiter)
const inPath = pathDirs.some((dir) => dir.toLowerCase() === installDir.toLowerCase())

if (inPath) {
  console.log(`✓ ${installDir} is already in your PATH`)
} else {
  console.log(`⚠️  Add to PATH: ${installDir}`)
  if (process.platform === "win32") {
    console.log('   Run: setx PATH "%LOCALAPPDATA%\\opencode\\bin;%PATH%"')
  } else {
    console.log(`   Add to ~/.bashrc or ~/.zshrc:`)
    console.log(`   export PATH="${installDir}:$PATH"`)
  }
}

// Verify installation
console.log("\n🧪 Testing installation...")
const version = await $`${installedPath} --version`.text()
console.log(`✓ Version: ${version.trim()}`)

console.log("\n✅ Dev installation complete!")
