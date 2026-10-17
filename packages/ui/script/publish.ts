#!/usr/bin/env bun

import { NpmLibraries } from "@opencode/script/npm"
import { $ } from "bun"
import { rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { pack } from "./pack"

process.chdir(fileURLToPath(new URL("..", import.meta.url)))

// SAFETY: this is the package's own manifest, which always has a name and a version.
const pkg = (await Bun.file("package.json").json()) as { name: string; version: string }

const tarball = `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`

if (!NpmLibraries.packDir && (await $`npm view ${pkg.name}@${pkg.version} version`.nothrow()).exitCode === 0) {
  console.log(`already published ${pkg.name}@${pkg.version}`)
  process.exit(0)
}

const carried = await NpmLibraries.carried(tarball)

if (carried) {
  await NpmLibraries.publish(carried)
  process.exit(0)
}

try {
  await $`bun run typecheck`
  await $`bun run test`
  await pack()
  await NpmLibraries.publish(tarball)
} finally {
  await rm(tarball, { force: true })
}
