#!/usr/bin/env bun

import { Script } from "@opencode/script"
import { $ } from "bun"
import { rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { pack } from "./pack"

process.chdir(fileURLToPath(new URL("..", import.meta.url)))

// SAFETY: this package's own package.json always declares a string name and version.
const pkg = (await Bun.file("package.json").json()) as { name: string; version: string }

const tarball = `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`

if ((await $`npm view ${pkg.name}@${pkg.version} version`.nothrow()).exitCode === 0) {
  console.log(`already published ${pkg.name}@${pkg.version}`)
  process.exit(0)
}

try {
  await $`bun run typecheck:tsc`
  await $`bun run test`
  await pack()
  await $`npm publish ${tarball} --access public --tag ${Script.channel}`
} finally {
  await rm(tarball, { force: true })
}
