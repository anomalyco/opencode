import { $ } from "bun"

import { copyBinaryToSidecarFolder, getCurrentSidecar } from "./utils"

const RUST_TARGET = Bun.env.TAURI_ENV_TARGET_TRIPLE

const sidecarConfig = getCurrentSidecar(RUST_TARGET)

const binaryPath = `../crazycode/dist/${sidecarConfig.ocBinary}/bin/crazycode${process.platform === "win32" ? ".exe" : ""}`

await $`cd ../crazycode && bun run build --single`

await copyBinaryToSidecarFolder(binaryPath, RUST_TARGET)
