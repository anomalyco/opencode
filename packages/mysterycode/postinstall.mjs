#!/usr/bin/env node

import fs from "fs"
import path from "path"
import os from "os"
import { fileURLToPath } from "url"
import { createRequire } from "module"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

function detectPlatformAndArch() {
  const platform = os.platform() === "win32" ? "windows" : os.platform()
  const arch = os.arch()
  return { platform, arch }
}

function findBinary() {
  const { platform, arch } = detectPlatformAndArch()
  const packageName = `opencode-${platform}-${arch}`
  const binaryName = platform === "windows" ? "opencode.exe" : "opencode"
  const packageJsonPath = require.resolve(`${packageName}/package.json`)
  const packageDir = path.dirname(packageJsonPath)
  const binaryPath = path.join(packageDir, "bin", binaryName)
  if (!fs.existsSync(binaryPath)) throw new Error(`Binary not found at ${binaryPath}`)
  return binaryPath
}

async function main() {
  if (os.platform() === "win32") return
  const binaryPath = findBinary()
  const target = path.join(__dirname, "bin", ".mysterycode")
  if (fs.existsSync(target)) fs.unlinkSync(target)
  try {
    fs.linkSync(binaryPath, target)
  } catch {
    fs.copyFileSync(binaryPath, target)
  }
  fs.chmodSync(target, 0o755)
}

main().catch((error) => {
  console.error("Failed to setup mysterycode binary:", error.message)
  process.exit(1)
})
