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

  const binDir = path.join(__dirname, "bin")
  const unixScript = path.join(binDir, "opencode")

  console.log("Windows detected: Configuring bin scripts for Windows")

  if (fs.existsSync(unixScript)) {
    console.log("Removing Unix shell script from bin/")
    fs.unlinkSync(unixScript)
  }
}

try {
  main()
} catch (error) {
  console.error("Preinstall script error:", error.message)
  process.exit(0)
}
