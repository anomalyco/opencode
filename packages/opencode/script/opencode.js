#!/usr/bin/env node

import { execFileSync } from "node:child_process"

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export default function getExePath() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const normalizedDirname = __dirname.replace(/\\/g, "/")

  let exeDir

  const expectedPackage = "native-preview-" + process.platform + "-" + process.arch

  if (normalizedDirname.endsWith("/_packages/native-preview/lib")) {
    // We're running directly from source in the repo.
    exeDir = path.resolve(__dirname, "..", "..", "..", "built", "local")
  } else if (normalizedDirname.endsWith("/built/npm/native-preview/lib")) {
    // We're running from the built output.
    exeDir = path.resolve(__dirname, "..", "..", expectedPackage, "lib")
  } else {
    // We're actually running from an installed package.
    const platformPackageName = "@typescript/" + expectedPackage
    let packageJson
    try {
      // v20.6.0, v18.19.0
      packageJson = import.meta.resolve(platformPackageName + "/package.json")
    } catch (e) {
      throw new Error(
        "Unable to resolve " +
          platformPackageName +
          ". Either your platform is unsupported, or you are missing the package on disk.",
      )
    }
    const packageJsonPath = fileURLToPath(packageJson)
    exeDir = path.join(path.dirname(packageJsonPath), "lib")
  }

  const exe = path.join(exeDir, "tsgo" + (process.platform === "win32" ? ".exe" : ""))

  if (!fs.existsSync(exe)) {
    throw new Error("Executable not found: " + exe)
  }

  return exe
}

const exe = getExePath()

try {
  execFileSync(exe, process.argv.slice(2), { stdio: "inherit" })
} catch (e) {
  if (e.status) {
    process.exitCode = e.status
  } else {
    throw e
  }
}
