#!/usr/bin/env bun
import { $ } from "bun"
import path from "node:path"

import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

const artifact = process.env.OPENCODE_CLI_ARTIFACT
const runId = process.env.GITHUB_RUN_ID

if (!artifact || !runId) {
  console.log(`Skipping CLI download (OPENCODE_CLI_ARTIFACT=${artifact ?? ""}, GITHUB_RUN_ID=${runId ?? ""})`)
  process.exit(0)
}

const sidecar = getCurrentSidecar()
const downloadDir = path.resolve(import.meta.dir, "../.cli-artifact")

await $`rm -rf ${downloadDir}`
await $`mkdir -p ${downloadDir}`
await $`gh run download ${runId} --name ${artifact} --dir ${downloadDir}`

const source = windowsify(path.join(downloadDir, sidecar.ocBinary, "bin", "opencode"))
await copyBinaryToSidecarFolder(source)
