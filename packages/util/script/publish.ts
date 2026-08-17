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
  imports: Record<string, Record<string, string>>
}
const tarball = `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`

if ((await $`npm view ${pkg.name}@${pkg.version} version`.nothrow()).exitCode === 0) {
  console.log(`already published ${pkg.name}@${pkg.version}`)
  process.exit(0)
}

const output = (value: string, extension: ".js" | ".d.ts") =>
  value.replace("./src/", "./dist/").replace(/\.ts$/, extension)

try {
  await $`bun run typecheck`
  await $`bun run build`
  pkg.exports = Object.fromEntries(
    Object.entries(pkg.exports).map(([key, value]) => {
      if (typeof value !== "string") return [key, value]
      return [key, { import: output(value, ".js"), types: output(value, ".d.ts") }]
    }),
  )
  pkg.imports = Object.fromEntries(
    Object.entries(pkg.imports).map(([key, conditions]) => [
      key,
      Object.fromEntries(Object.entries(conditions).map(([condition, value]) => [condition, output(value, ".js")])),
    ]),
  )
  await Bun.write("package.json", JSON.stringify(pkg, null, 2) + "\n")
  await rm(tarball, { force: true })
  await $`bun pm pack`
  await $`npm publish ${tarball} --tag ${Script.channel} --access public`
} finally {
  await Bun.write("package.json", originalText)
  await rm(tarball, { force: true })
}
