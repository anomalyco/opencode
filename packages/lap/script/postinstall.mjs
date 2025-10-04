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

async function regenerateWindowsCmdWrappers() {
  console.log("Windows + npm detected: Forcing npm to rebuild bin links")

  try {
    const { execSync } = require("child_process")
    const pkgPath = path.join(__dirname, "..")

    // npm_config_global is string | undefined
    // if it exists, the value is true
    const isGlobal = process.env.npm_config_global === "true" || pkgPath.includes(path.join("npm", "node_modules"))

    // The npm rebuild command does 2 things - Execute lifecycle scripts and rebuild bin links
    // We want to skip lifecycle scripts to avoid infinite loops, so we use --ignore-scripts
    const cmd = `npm rebuild opencode-ai --ignore-scripts${isGlobal ? " -g" : ""}`
    const opts = {
      stdio: "inherit",
      shell: true,
      ...(isGlobal ? {} : { cwd: path.join(pkgPath, "..", "..") }), // For local, run from project root
    }

    console.log(`Running: ${cmd}`)
    execSync(cmd, opts)
    console.log("Successfully rebuilt npm bin links")
  } catch (error) {
    console.error("Error rebuilding npm links:", error.message)
    console.error("npm rebuild failed. You may need to manually run: npm rebuild opencode-ai --ignore-scripts")
  }
}

async function main() {
  try {
    if (os.platform() === "win32") {
      // NPM eg format - npm/11.4.2 node/v24.4.1 win32 x64
      // Bun eg format - bun/1.2.19 npm/? node/v24.3.0 win32 x64
      if (process.env.npm_config_user_agent.startsWith("npm")) {
        await regenerateWindowsCmdWrappers()
      } else {
        console.log("Windows detected but not npm, skipping postinstall")
      }
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

try {
  main()
} catch (error) {
  console.error("Postinstall script error:", error.message)
  process.exit(0)
}
