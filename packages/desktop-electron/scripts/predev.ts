import { $ } from "bun"

import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

await $`bun ./scripts/copy-icons.ts ${process.env.XCSH_CHANNEL ?? "dev"}`

const RUST_TARGET = Bun.env.RUST_TARGET

const sidecarConfig = getCurrentSidecar(RUST_TARGET)

const binaryPath = windowsify(`../xcsh/dist/${sidecarConfig.ocBinary}/bin/xcsh`)

await (sidecarConfig.ocBinary.includes("-baseline")
  ? $`cd ../xcsh && bun run build --single --baseline`
  : $`cd ../xcsh && bun run build --single`)

await copyBinaryToSidecarFolder(binaryPath, RUST_TARGET)
