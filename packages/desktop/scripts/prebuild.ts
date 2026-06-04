#!/usr/bin/env bun
import { $ } from "bun"

import { copyBinaryToSidecarFolder, getCurrentSidecar, resolveChannel, windowsify } from "./utils"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

await $`bun ../../script/sync-version.ts`

const sidecarConfig = getCurrentSidecar()
const baseline = sidecarConfig.ocBinary.includes("-baseline")
const build = baseline
  ? $`bun run build --single --baseline --skip-embed-web-ui`
  : $`bun run build --single --skip-embed-web-ui`
const result = await build.cwd("../opencode").nothrow()

let binary = sidecarConfig.ocBinary
if (result.exitCode !== 0 && baseline && process.platform === "win32") {
  binary = binary.replace("-baseline", "")
  console.warn(`baseline sidecar build failed, falling back to ${binary}`)
  const retry = await $`bun run build --single --skip-embed-web-ui`.cwd("../opencode").nothrow()
  if (retry.exitCode !== 0) process.exit(retry.exitCode)
} else if (result.exitCode !== 0) {
  process.exit(result.exitCode)
}

await $`bun script/build-node.ts`.cwd("../opencode")
await copyBinaryToSidecarFolder(windowsify(`../opencode/dist/${binary}/bin/opencode`), sidecarConfig.rustTarget)
