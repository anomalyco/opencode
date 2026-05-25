#!/usr/bin/env bun
import { $ } from "bun"
import { Script } from "@opencode-ai/script"
import { getCurrentSidecar, windowsify, copyBinaryToSidecarFolder } from "./utils"

await import("./prebuild")

await $`bun ../../script/sync-version.ts ${Script.version}`
console.log(`Updated manifests to ${Script.version}`)

const sidecarConfig = getCurrentSidecar()

const dir = "src-tauri/target/opencode-binaries"

await $`mkdir -p ${dir}`
await $`gh run download ${Bun.env.GITHUB_RUN_ID} -n opencode-cli`.cwd(dir)

await copyBinaryToSidecarFolder(windowsify(`${dir}/${sidecarConfig.ocBinary}/bin/opencode`))
