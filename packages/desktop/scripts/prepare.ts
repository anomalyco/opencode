#!/usr/bin/env bun
import { $ } from "bun"

import { Script } from "@f5xc-salesdemos/script"
import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

const pkg = await Bun.file("./package.json").json()
pkg.version = Script.version
await Bun.write("./package.json", JSON.stringify(pkg, null, 2) + "\n")
console.log(`Updated package.json version to ${Script.version}`)

const sidecarConfig = getCurrentSidecar()
const artifact = process.env.XCSH_CLI_ARTIFACT ?? "xcsh-cli"

const dir = "src-tauri/target/xcsh-binaries"

await $`mkdir -p ${dir}`
await $`gh run download ${process.env.GITHUB_RUN_ID} -n ${artifact}`.cwd(dir)

await copyBinaryToSidecarFolder(windowsify(`${dir}/${sidecarConfig.ocBinary}/bin/xcsh`))
