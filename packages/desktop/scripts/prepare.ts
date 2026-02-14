#!/usr/bin/env bun
import { $ } from "bun"

import { Script } from "@cyberstrike-io/script"
import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

const pkg = await Bun.file("./package.json").json()
pkg.version = Script.version
await Bun.write("./package.json", JSON.stringify(pkg, null, 2) + "\n")
console.log(`Updated package.json version to ${Script.version}`)

const sidecarConfig = getCurrentSidecar()

const dir = "src-tauri/target/cyberstrike-binaries"

await $`mkdir -p ${dir}`
await $`gh run download ${Bun.env.GITHUB_RUN_ID} -n cyberstrike-cli`.cwd(dir)

await copyBinaryToSidecarFolder(windowsify(`${dir}/${sidecarConfig.ocBinary}/bin/cyberstrike`))
