import { $ } from "bun"
import { getCurrentSidecar, windowsify, copyBinaryToSidecarFolder } from "./utils"

await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`

const RUST_TARGET = Bun.env.TAURI_ENV_TARGET_TRIPLE

const sidecarConfig = getCurrentSidecar(RUST_TARGET)
const rustTarget = RUST_TARGET ?? sidecarConfig.rustTarget

async function build(baseline: boolean) {
  const cmd = baseline ? $`bun run build --single --baseline` : $`bun run build --single`
  return cmd.cwd("../opencode").nothrow()
}

await $`bun ../../script/sync-version.ts`

function fallbackBinary(name: string) {
  return name.replace("-baseline", "")
}

let binary = sidecarConfig.ocBinary

const baseline = sidecarConfig.ocBinary.includes("-baseline")

if (baseline) {
  const result = await build(true)
  if (result.exitCode !== 0 && process.platform === "win32") {
    binary = fallbackBinary(binary)
    console.warn(`baseline sidecar build failed, falling back to ${binary}`)
    const retry = await build(false)
    if (retry.exitCode !== 0) process.exit(retry.exitCode)
  }
  if (result.exitCode !== 0 && process.platform !== "win32") process.exit(result.exitCode)
}

if (!baseline) {
  const result = await build(false)
  if (result.exitCode !== 0) process.exit(result.exitCode)
}

await $`bun script/build-node.ts`.cwd("../opencode")

const binaryPath = windowsify(`../opencode/dist/${binary}/bin/opencode`)

await copyBinaryToSidecarFolder(binaryPath, rustTarget)
