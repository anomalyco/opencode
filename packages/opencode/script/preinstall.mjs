#!/usr/bin/env node

import fs from "fs"
import path from "path"
import os from "os"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function main() {
  if (os.platform() !== "win32") {
    console.log("Non-Windows platform detected, skipping preinstall")
    return
  }

  console.log("Windows detected: Modifying package.json bin entry")

  // Read package.json
  const packageJsonPath = path.join(__dirname, "package.json")
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))

  // Modify bin to point to .cmd files on Windows
  packageJson.bin = {
    codesurf: "./bin/codesurf.cmd",
    surf: "./bin/surf.cmd",
  }

  // Write it back
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2))
  console.log("Updated package.json bin to use codesurf.cmd and surf.cmd")

  // Remove Unix scripts if they exist
  const codeSurfUnix = path.join(__dirname, "bin", "codesurf")
  const surfUnix = path.join(__dirname, "bin", "surf")
  if (fs.existsSync(codeSurfUnix)) {
    console.log("Removing Unix codesurf script")
    fs.unlinkSync(codeSurfUnix)
  }
  if (fs.existsSync(surfUnix)) {
    console.log("Removing Unix surf script")
    fs.unlinkSync(surfUnix)
  }
}

try {
  main()
} catch (error) {
  console.error("Preinstall script error:", error.message)
  process.exit(0)
}
