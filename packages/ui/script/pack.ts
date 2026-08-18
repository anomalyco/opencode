#!/usr/bin/env bun

import { $ } from "bun"
import { rm } from "node:fs/promises"
import path from "node:path"

export async function pack() {
  const original = await Bun.file("package.json").text()
  const pkg = JSON.parse(original) as {
    name: string
    version: string
    exports: Record<string, string | { types: string; import: string }>
  }
  const tarball = path.resolve(`${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`)

  await $`bun run build`
  pkg.exports = Object.fromEntries(
    Object.entries(pkg.exports).map(([key, value]) => {
      if (typeof value !== "string" || (!value.endsWith(".ts") && !value.endsWith(".tsx"))) return [key, value]
      return [
        key,
        {
          types: value.replace("./src/", "./dist/").replace(/\.tsx?$/, ".d.ts"),
          import: value,
        },
      ]
    }),
  )

  await rm(tarball, { force: true })
  await Bun.write("package.json", JSON.stringify(pkg, null, 2) + "\n")
  try {
    await $`bun pm pack`
    return tarball
  } finally {
    await Bun.write("package.json", original)
  }
}

if (import.meta.main) console.log(await pack())
