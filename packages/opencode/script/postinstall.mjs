#!/usr/bin/env node

import fs from "fs"
import path from "path"
import os from "os"
import { fileURLToPath } from "url"
import { createRequire } from "module"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

function detectPlatformAndArch() {
  // Map platform names
  let platform
  switch (os.platform()) {
    case "darwin":
      platform = "darwin"
      break
    case "linux":
      platform = "linux"
      break
    case "win32":
      platform = "windows"
      break
    default:
      platform = os.platform()
      break
  }

  // Map architecture names
  let arch
  switch (os.arch()) {
    case "x64":
      arch = "x64"
      break
    case "arm64":
      arch = "arm64"
      break
    case "arm":
      arch = "arm"
      break
    default:
      arch = os.arch()
      break
  }

  return { platform, arch }
}

function findBinary() {
  const { platform, arch } = detectPlatformAndArch()
  const packageName = `opencode-${platform}-${arch}`
  const binary = platform === "windows" ? "opencode.exe" : "opencode"

  try {
    // Use require.resolve to find the package
    const packageJsonPath = require.resolve(`${packageName}/package.json`)
    const packageDir = path.dirname(packageJsonPath)
    const binaryPath = path.join(packageDir, "bin", binary)

    if (!fs.existsSync(binaryPath)) {
      throw new Error(`Binary not found at ${binaryPath}`)
    }

    return binaryPath
  } catch (error) {
    throw new Error(`Could not find package ${packageName}: ${error.message}`)
  }
}

function main() {
  try {
    if (os.platform() === "win32") {
      console.log("Windows detected, skipping postinstall")
      return
    }

    const binaryPath = findBinary()
    const binScript = path.join(__dirname, "bin", "opencode")

    // Remove existing bin script if it exists
    if (fs.existsSync(binScript)) {
      fs.unlinkSync(binScript)
    }

    // Create symlink to the actual binary
    fs.symlinkSync(binaryPath, binScript)
    console.log(`opencode binary symlinked: ${binScript} -> ${binaryPath}`)
  } catch (error) {
    console.error("Failed to create opencode binary symlink:", error.message)
    process.exit(1)
  }
}

main()
