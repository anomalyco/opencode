import { $ } from "bun"

import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

const RUST_TARGET = Bun.env.TAURI_ENV_TARGET_TRIPLE

const sidecarConfig = getCurrentSidecar(RUST_TARGET)

const binaryPath = windowsify(`../athena/dist/${sidecarConfig.ocBinary}/bin/athena`)

await (sidecarConfig.ocBinary.includes("-baseline")
  ? $`cd ../athena && bun run build --single --baseline`
  : $`cd ../athena && bun run build --single`)

await copyBinaryToSidecarFolder(binaryPath, RUST_TARGET)
