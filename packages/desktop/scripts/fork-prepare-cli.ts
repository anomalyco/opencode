#!/usr/bin/env bun

import { $ } from "bun"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { getCurrentSidecar, windowsify } from "./utils"

const distRoot = path.resolve(import.meta.dirname, "../../opencode/dist")
const { ocBinary, assetExt } = getCurrentSidecar()
const archive = path.join(distRoot, `${ocBinary}.${assetExt}`)

if (!(await Bun.file(archive).exists())) {
  throw new Error(`CLI archive not found: ${archive}`)
}

const temp = await mkdtemp(path.join(tmpdir(), "opencode-cli-"))
try {
  if (assetExt === "zip") {
    await $`unzip -oq ${archive} -d ${temp}`
  } else {
    await $`tar -xzf ${archive} -C ${temp}`
  }

  const entries = await Array.fromAsync(new Bun.Glob("opencode*").scan({ cwd: temp }))
  const binary = entries.map((file) => path.join(temp, file))[0] ?? path.join(temp, "opencode")

  if (!(await Bun.file(binary).exists())) {
    throw new Error(`Extracted CLI binary not found in ${temp}`)
  }

  const dest = windowsify("resources/opencode-cli")
  await $`mkdir -p resources`
  await $`cp ${binary} ${dest}`
  if (process.platform !== "win32") {
    await $`chmod +x ${dest}`
  }
  console.log(`Prepared unsigned desktop sidecar from ${archive} -> ${dest}`)
} finally {
  await rm(temp, { recursive: true, force: true })
}
