import { $ } from "bun"

import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

const RUST_TARGET = Bun.env.TAURI_ENV_TARGET_TRIPLE

const sidecarConfig = getCurrentSidecar(RUST_TARGET)

// Root of the repo is two levels up from packages/desktop/
const ROOT = "../.."

const binaryPath = windowsify(`${ROOT}/dist/${sidecarConfig.ocBinary}/bin/athena`)

await (sidecarConfig.ocBinary.includes("-baseline")
  ? $`cd ${ROOT} && bun run build --single --baseline`
  : $`cd ${ROOT} && bun run build --single`)

await copyBinaryToSidecarFolder(binaryPath, RUST_TARGET)
