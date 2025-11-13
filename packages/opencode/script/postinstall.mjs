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
  const binaryName = platform === "windows" ? "opencode.exe" : "opencode"

  try {
    // Use require.resolve to find the package
    const packageJsonPath = require.resolve(`${packageName}/package.json`)
    const packageDir = path.dirname(packageJsonPath)
    const binaryPath = path.join(packageDir, "bin", binaryName)

    if (!fs.existsSync(binaryPath)) {
      throw new Error(`Binary not found at ${binaryPath}`)
    }

    return { binaryPath, binaryName }
  } catch (error) {
    throw new Error(`Could not find package ${packageName}: ${error.message}`)
  }
}

function prepareBinDirectory(binaryName) {
  const binDir = path.join(__dirname, "bin")
  const targetPath = path.join(binDir, binaryName)

  // Ensure bin directory exists
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true })
  }

  // Remove existing binary/symlink if it exists
  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath)
  }

  return { binDir, targetPath }
}

function copyBinary(sourcePath, binaryName) {
  const { targetPath } = prepareBinDirectory(binaryName)

  fs.copyFileSync(sourcePath, targetPath)
  console.log(`opencode binary installed: ${targetPath}`)

  // Verify the file exists after operation
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Failed to copy binary to ${targetPath}`)
  }
}

function symlinkBinary(sourcePath, binaryName) {
  const { targetPath } = prepareBinDirectory(binaryName)

  fs.symlinkSync(sourcePath, targetPath)
  console.log(`opencode binary symlinked: ${targetPath} -> ${sourcePath}`)

  // Verify the file exists after operation
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Failed to symlink binary to ${targetPath}`)
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
      // pnpm eg format - pnpm/8.10.0 npm/? node/v20.10.0 win32 x64
      const userAgent = process.env.npm_config_user_agent || ""

      if (userAgent.startsWith("npm")) {
        await regenerateWindowsCmdWrappers()
        return
      }

      if (userAgent.startsWith("bun")) {
        console.log("Windows + bun detected: Setting up binary")
        const { binaryPath, binaryName } = findBinary()
        copyBinary(binaryPath, binaryName)
        return
      }

      if (userAgent.startsWith("pnpm")) {
        console.log("Windows + pnpm detected: Setting up binary")
        const { binaryPath, binaryName } = findBinary()
        copyBinary(binaryPath, binaryName)
        return
      }

      // Unknown package manager on Windows
      console.log("Windows detected but unknown package manager, skipping postinstall")
      return
    }

    const { binaryPath, binaryName } = findBinary()
    symlinkBinary(binaryPath, binaryName)
  } catch (error) {
    console.error("Failed to setup opencode binary:", error.message)
    process.exit(1)
  }
}

try {
  main()
} catch (error) {
  console.error("Postinstall script error:", error.message)
  process.exit(0)
}
