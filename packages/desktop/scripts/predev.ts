import { $ } from "bun"
import path from "path"

import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

if (Bun.env.OPENCODE_SKIP_SIDECAR === "1") {
  console.log("[predev] OPENCODE_SKIP_SIDECAR=1, skipping sidecar build/copy")
  process.exit(0)
}

const host = () => {
  if (process.platform === "darwin") {
    if (process.arch === "arm64") return "aarch64-apple-darwin"
    return "x86_64-apple-darwin"
  }
  if (process.platform === "win32") return "x86_64-pc-windows-msvc"
  if (process.arch === "arm64") return "aarch64-unknown-linux-gnu"
  return "x86_64-unknown-linux-gnu"
}

const RUST_TARGET = Bun.env.TAURI_ENV_TARGET_TRIPLE ?? Bun.env.RUST_TARGET ?? host()

const sidecarConfig = getCurrentSidecar(RUST_TARGET)

const binaryPath = windowsify(`../opencode/dist/${sidecarConfig.ocBinary}/bin/opencode`)

const models = Bun.env.MODELS_DEV_API_JSON ?? path.join("test", "tool", "fixtures", "models-api.json")

await $`cd ../opencode && bun run build --single --skip-install`.env({
  ...Bun.env,
  MODELS_DEV_API_JSON: models,
})

await copyBinaryToSidecarFolder(binaryPath, RUST_TARGET)
