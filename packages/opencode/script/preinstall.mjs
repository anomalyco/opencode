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

  // Modify bin to point to .cmd file on Windows
  packageJson.bin = {
    opencode: "./bin/opencode.cmd",
  }

  // Write it back
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2))
  console.log("Updated package.json bin to use opencode.cmd")

  // Now you can also remove the Unix script if you want
  const unixScript = path.join(__dirname, "bin", "opencode")
  if (fs.existsSync(unixScript)) {
    console.log("Removing Unix shell script")
    fs.unlinkSync(unixScript)
  }
}

try {
  main()
} catch (error) {
  console.error("Preinstall script error:", error.message)
  process.exit(0)
}
