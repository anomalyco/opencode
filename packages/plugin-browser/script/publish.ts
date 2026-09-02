#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"
import { rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import pkg from "../package.json"

process.chdir(fileURLToPath(new URL("..", import.meta.url)))

if ((await $`npm view ${pkg.name}@${pkg.version} version`.nothrow()).exitCode === 0) {
  console.log(`already published ${pkg.name}@${pkg.version}`)
  process.exit(0)
}

await $`bun run typecheck`
await $`bun run build`
const original = await Bun.file("package.json").text()
const tarball = `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`
try {
  await Bun.write(
    "package.json",
    JSON.stringify(
      {
        ...pkg,
        exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } },
      },
      null,
      2,
    ) + "\n",
  )
  await rm(tarball, { force: true })
  await $`bun pm pack`
  await $`npm publish ${tarball} --tag ${Script.channel} --access public`
} finally {
  await Bun.write("package.json", original)
  await rm(tarball, { force: true })
}
