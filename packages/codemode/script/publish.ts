#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

process.chdir(fileURLToPath(new URL("..", import.meta.url)))

const dryRun = Bun.argv.includes("--dry-run")
const originalText = await Bun.file("package.json").text()
const pkg = JSON.parse(originalText) as {
  name: string
  version: string
  exports: Record<string, string | { import: string; types: string }>
  imports: Record<string, Record<string, string>>
}
const tarball = `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`
const output = (value: string, types = false) =>
  value.replace("./src/", "./dist/").replace(/\.ts$/, types ? ".d.ts" : ".js")

if (!dryRun && (await $`npm view ${pkg.name}@${pkg.version} version`.nothrow()).exitCode === 0) {
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
          import: output(value),
          types: output(value, true),
        },
      ]
    }),
  )
  pkg.imports = Object.fromEntries(
    Object.entries(pkg.imports).map(([key, conditions]) => [
      key,
      Object.fromEntries(Object.entries(conditions).map(([condition, value]) => [condition, output(value)])),
    ]),
  )
  await Bun.write("package.json", JSON.stringify(pkg, null, 2) + "\n")
  await rm(tarball, { force: true })
  await $`bun pm pack`
  const consumer = await mkdtemp(join(tmpdir(), "opencode-codemode-"))
  try {
    await Bun.write(
      join(consumer, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        dependencies: { [pkg.name]: `file:${join(process.cwd(), tarball)}` },
      }),
    )
    await $`npm install --ignore-scripts --no-audit --no-fund`.cwd(consumer)
    await $`node --input-type=module -e ${`await import(${JSON.stringify(pkg.name)})`}`.cwd(consumer)
    await $`bun --conditions=workerd -e ${`await import(${JSON.stringify(pkg.name)})`}`.cwd(consumer)
  } finally {
    await rm(consumer, { recursive: true, force: true })
  }
  if (!dryRun) await $`npm publish ${tarball} --tag ${Script.channel} --access public`
} finally {
  await Bun.write("package.json", originalText)
  await rm(tarball, { force: true })
}
