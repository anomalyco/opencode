#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"
import { rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"

process.chdir(fileURLToPath(new URL("..", import.meta.url)))

const originalText = await Bun.file("package.json").text()
const pkg = JSON.parse(originalText) as {
  name: string
  version: string
  exports: Record<string, string | { import: string; types: string }>
}
const tarball = `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`

if ((await $`npm view ${pkg.name}@${pkg.version} version`.nothrow()).exitCode === 0) {
  console.log(`already published ${pkg.name}@${pkg.version}`)
  process.exit(0)
}

try {
  await $`bun run typecheck`
  await $`bun run build`
  pkg.exports = Object.fromEntries(
    Object.entries(pkg.exports).map(([key, value]) => {
      if (typeof value !== "string") return [key, value]
      return [
        key,
        {
          import: value.replace("./src/", "./dist/").replace(/\.ts$/, ".js"),
          types: value.replace("./src/", "./dist/").replace(/\.ts$/, ".d.ts"),
        },
      ]
    }),
  )
  await Bun.write("package.json", JSON.stringify(pkg, null, 2) + "\n")
  await rm(tarball, { force: true })
  await $`bun pm pack`
  await $`npm publish ${tarball} --tag ${Script.channel} --access public`
} finally {
  await Bun.write("package.json", originalText)
  await rm(tarball, { force: true })
}
