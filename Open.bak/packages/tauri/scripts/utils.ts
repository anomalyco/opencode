import { execSync } from "child_process"
import fs from "fs"
import path from "path"

export const SIDECAR_BINARIES: Array<{ rustTarget: string; ocBinary: string; assetExt: string }> = [
  {
    rustTarget: "aarch64-apple-darwin",
    ocBinary: "opendeepseek-darwin-arm64",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-apple-darwin",
    ocBinary: "opendeepseek-darwin-x64",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-pc-windows-msvc",
    ocBinary: "opendeepseek-windows-x64",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-unknown-linux-gnu",
    ocBinary: "opendeepseek-linux-x64",
    assetExt: "tar.gz",
  },
]

export const RUST_TARGET = process.env.TAURI_ENV_TARGET_TRIPLE || process.env.RUST_TARGET

export function getCurrentSidecar(target = RUST_TARGET) {
  if (!target) {
    // Auto-detect target when running outside of Tauri CLI
    const platform = process.platform
    const arch = process.arch

    if (platform === "win32" && arch === "x64") target = "x86_64-pc-windows-msvc"
    else if (platform === "darwin" && arch === "arm64") target = "aarch64-apple-darwin"
    else if (platform === "darwin" && arch === "x64") target = "x86_64-apple-darwin"
    else if (platform === "linux" && arch === "x64") target = "x86_64-unknown-linux-gnu"
    else throw new Error(`Unsupported platform: ${platform}-${arch}`)

    console.log(`Auto-detected target: ${target}`)
  }

  const binaryConfig = SIDECAR_BINARIES.find((b) => b.rustTarget === target)
  if (!binaryConfig) throw new Error(`Sidecar configuration not available for Rust target '${target}'`)

  return binaryConfig
}

export async function copyBinaryToSidecarFolder(source: string, target = RUST_TARGET) {
  const sidecarDir = path.resolve("src-tauri/sidecars")
  if (!fs.existsSync(sidecarDir)) {
    fs.mkdirSync(sidecarDir, { recursive: true })
  }

  const dest = path.join(sidecarDir, `opendeepseek-cli-${target}${process.platform === "win32" ? ".exe" : ""}`)

  // Use read + write instead of copy to ensure file handles are properly closed
  const data = fs.readFileSync(source)
  fs.writeFileSync(dest, data)

  console.log(`Copied ${source} to ${dest}`)
}
