#!/usr/bin/env bun
import { $ } from "bun"
import { fileURLToPath } from "node:url"

const dir = fileURLToPath(new URL("..", import.meta.url))

export const pack = async () => {
  process.chdir(dir)
  await $`bun run build`
  const original = await Bun.file("package.json").text()
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- package.json is validated by the package schema and build checks.
  const pkg = JSON.parse(original) as {
    readonly version: string
    exports: Record<string, string | { readonly import: string; readonly types: string }>
  }

  for (const [key, value] of Object.entries(pkg.exports)) {
    if (key === "./internal") {
      delete pkg.exports[key]
      continue
    }
    if (typeof value !== "string") continue
    const file = value.replace("./src/", "./dist/").replace(/\.ts$/, "")
    pkg.exports[key] = { import: `${file}.js`, types: `${file}.d.ts` }
  }
  await Bun.write("package.json", JSON.stringify(pkg, null, 2))
  try {
    await $`bun pm pack`
    return fileURLToPath(new URL(`../opencode-ai-http-recorder-${pkg.version}.tgz`, import.meta.url))
  } finally {
    await Bun.write("package.json", original)
  }
}

if (import.meta.main) await pack()
