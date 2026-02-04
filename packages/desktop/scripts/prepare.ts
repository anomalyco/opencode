#!/usr/bin/env bun
import { $ } from "bun"

import { Script } from "@opencode-ai/script"
import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

const pkg = await Bun.file("./package.json").json()
pkg.version = Script.version
await Bun.write("./package.json", JSON.stringify(pkg, null, 2) + "\n")
console.log(`Updated package.json version to ${Script.version}`)

const sidecarConfig = getCurrentSidecar()

const dir = "src-tauri/target/opencode-binaries"

await $`mkdir -p ${dir}`
await $`gh run download ${Bun.env.GITHUB_RUN_ID} -n opencode-cli`.cwd(dir)

await copyBinaryToSidecarFolder(windowsify(`${dir}/${sidecarConfig.ocBinary}/bin/opencode`))

// Build the mirror web UI for the sidecar to serve via OPENCODE_WEB_DIR
console.log("Building mirror web UI for sidecar...")
await $`cd ../app && bun run build:mirror`
await $`mkdir -p src-tauri/web-ui`
await $`cp -r ../app/dist-mirror/ src-tauri/web-ui/`
await $`mv src-tauri/web-ui/mirror.html src-tauri/web-ui/index.html`
console.log("Mirror web UI built and copied to src-tauri/web-ui/")
