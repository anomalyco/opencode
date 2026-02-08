import { $ } from "bun"
import path from "path"

import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

const RUST_TARGET = Bun.env.TAURI_ENV_TARGET_TRIPLE

const sidecarConfig = getCurrentSidecar(RUST_TARGET)

const binaryPath = windowsify(`../opencode/dist/${sidecarConfig.ocBinary}/bin/opencode`)

const models = Bun.env.MODELS_DEV_API_JSON ?? path.join("test", "tool", "fixtures", "models-api.json")

await $`cd ../opencode && bun run build --single --skip-install`.env({
  ...Bun.env,
  MODELS_DEV_API_JSON: models,
})

await copyBinaryToSidecarFolder(binaryPath, RUST_TARGET)
