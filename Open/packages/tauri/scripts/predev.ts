import { execSync } from "child_process"
import { copyBinaryToSidecarFolder, getCurrentSidecar } from "./utils"
import fs from "fs"
import path from "path"

const RUST_TARGET = process.env.TAURI_ENV_TARGET_TRIPLE || process.env.RUST_TARGET

const sidecarConfig = getCurrentSidecar(RUST_TARGET)

// Handle windows path separators and potential extension
const binaryPath = `../opendeepseek/dist/${sidecarConfig.ocBinary}/bin/opendeepseek${process.platform === "win32" ? ".exe" : ""}`
const sidecarDest = path.resolve(`src-tauri/sidecars/opendeepseek-cli-${RUST_TARGET}${process.platform === "win32" ? ".exe" : ""}`)

// Try to kill any existing opencode processes that might be locking the file
if (process.platform === "win32") {
  try {
    console.log("Stopping any existing opendeepseek processes...")
    execSync('taskkill /F /IM opendeepseek* /T', { stdio: "ignore" })
  } catch (e) {
    // Ignore error if process not found or access denied
  }
}

// Check if sidecar already exists and is recent (built in last 2 minutes)
const sidecarExists = fs.existsSync(sidecarDest)
const shouldRebuild = !sidecarExists || (Date.now() - fs.statSync(sidecarDest).mtimeMs > 2 * 60 * 1000)

if (shouldRebuild) {
  console.log("Building opendeepseek sidecar...")
  execSync("npm run build -- --single --skip-install", { cwd: "../opendeepseek", stdio: "inherit" })

  copyBinaryToSidecarFolder(binaryPath, RUST_TARGET)

  // Wait for Windows to release file locks
  console.log("Waiting for file system to sync...")
  await new Promise(resolve => setTimeout(resolve, 2000))

  console.log("Sidecar ready for Tauri build")
} else {
  console.log("Using existing sidecar binary (skipping rebuild to avoid file lock)")
}
