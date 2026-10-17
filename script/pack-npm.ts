#!/usr/bin/env bun

// publish.yml's pack-npm job: builds and packs the npm libraries into OPENCODE_NPM_PACK_DIR, with each library's own
// script and gates, so the publish job only publishes them. Publishes nothing.

import { NpmLibraries } from "@opencode/script/npm"
import { $ } from "bun"
import { mkdir } from "node:fs/promises"
import { fileURLToPath } from "url"
import { packageJsons, prepareReleaseFiles } from "./release-files"

process.chdir(fileURLToPath(new URL("..", import.meta.url)))

if (!NpmLibraries.packDir) throw new Error("OPENCODE_NPM_PACK_DIR is required")

await mkdir(NpmLibraries.packDir, { recursive: true })
await prepareReleaseFiles(await packageJsons())

for (const name of NpmLibraries.names) {
  console.log(`\n=== ${name} ===\n`)
  await $`bun ./packages/${name}/script/publish.ts`
}

await NpmLibraries.verify(NpmLibraries.packDir)
