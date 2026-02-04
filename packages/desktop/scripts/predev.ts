import { $ } from "bun"

import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

const RUST_TARGET = Bun.env.TAURI_ENV_TARGET_TRIPLE

const sidecarConfig = getCurrentSidecar(RUST_TARGET)

const binaryPath = windowsify(`../opencode/dist/${sidecarConfig.ocBinary}/bin/opencode`)

await (sidecarConfig.ocBinary.includes("-baseline")
  ? $`cd ../opencode && bun run build --single --baseline`
  : $`cd ../opencode && bun run build --single`)

await copyBinaryToSidecarFolder(binaryPath, RUST_TARGET)

// Build the mirror web UI for the sidecar to serve via OPENCODE_WEB_DIR
console.log("Building mirror web UI for sidecar...")
await $`cd ../app && bun run build:mirror`
await $`mkdir -p src-tauri/web-ui`
await $`cp -r ../app/dist-mirror/ src-tauri/web-ui/`
// Vite outputs mirror.html — rename to index.html so the sidecar serves it as the root
await $`mv src-tauri/web-ui/mirror.html src-tauri/web-ui/index.html`
console.log("Mirror web UI built and copied to src-tauri/web-ui/")
