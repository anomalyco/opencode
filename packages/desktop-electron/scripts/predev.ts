import { $ } from "bun"

import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`

const RUST_TARGET = Bun.env.RUST_TARGET

const sidecarConfig = getCurrentSidecar(RUST_TARGET)

const binaryPath = windowsify(`../opencode/dist/${sidecarConfig.ocBinary}/bin/opencode`)

// Skip baseline builds on Windows to avoid bun download issues
// Use FORCE_BASELINE=1 env var to override
const isBaseline = sidecarConfig.ocBinary.includes("-baseline")
const shouldSkipBaseline = isBaseline && process.platform === "win32" && !Bun.env.FORCE_BASELINE

if (shouldSkipBaseline) {
  console.log("Note: Skipping baseline build on Windows (bun download issue). Building standard version...")
  console.log("Set FORCE_BASELINE=1 to force baseline build if needed.")
  const standardBinary = sidecarConfig.ocBinary.replace("-baseline", "")
  const standardPath = windowsify(`../opencode/dist/${standardBinary}/bin/opencode`)
  await $`cd ../opencode && bun run build --single`
  await copyBinaryToSidecarFolder(standardPath)
} else {
  await (isBaseline
    ? $`cd ../opencode && bun run build --single --baseline`
    : $`cd ../opencode && bun run build --single`)
  await copyBinaryToSidecarFolder(binaryPath)
}
