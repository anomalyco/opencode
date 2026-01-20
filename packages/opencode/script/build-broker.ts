#!/usr/bin/env bun
/**
 * Build script for the opencode-broker Rust daemon.
 *
 * This script is intended to be run during npm install (postinstall hook).
 * It will:
 * 1. Check if the broker source exists
 * 2. Check if Rust/Cargo is available
 * 3. Build the broker with --release
 *
 * The script exits gracefully (exit 0) if Rust is unavailable or build fails,
 * since the auth broker is an optional feature.
 */

import { spawnSync } from "child_process"
import { existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const brokerDir = join(__dirname, "../../opencode-broker")

console.log("Checking opencode-broker build requirements...")

// Check if broker directory exists
if (!existsSync(join(brokerDir, "Cargo.toml"))) {
  console.log("Broker source not found, skipping build")
  process.exit(0)
}

// Check if Rust is installed
const rustCheck = spawnSync("cargo", ["--version"], { encoding: "utf8" })
if (rustCheck.status !== 0) {
  console.log("Rust not installed, skipping broker build")
  console.log("")
  console.log("To enable system authentication:")
  console.log("  1. Install Rust: https://rustup.rs/")
  console.log("  2. Build broker: cd packages/opencode-broker && cargo build --release")
  console.log("  3. Run setup: sudo opencode auth broker setup")
  process.exit(0)
}

console.log(`Building opencode-broker in ${brokerDir}...`)

// Build the broker
const buildResult = spawnSync("cargo", ["build", "--release"], {
  cwd: brokerDir,
  stdio: "inherit",
})

if (buildResult.status !== 0) {
  console.error("")
  console.error("Failed to build opencode-broker")
  console.error("System authentication will not be available")
  console.error("")
  console.error("You can try building manually:")
  console.error("  cd packages/opencode-broker && cargo build --release")
  // Don't fail the entire install - auth is optional
  process.exit(0)
}

console.log("")
console.log("opencode-broker built successfully!")
console.log("Run 'sudo opencode auth broker setup' to install the service")
