#!/usr/bin/env bun

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

import { $ } from "bun"

await $`bun tsc`

const pkg = await import("../package.json").then((m) => m.default)
const original = JSON.parse(JSON.stringify(pkg))
for (const [key, value] of Object.entries(pkg.exports)) {
  const file = value.replace("./src/", "./dist/").replace(".ts", "")
  pkg.exports[key] = {
    import: file + ".js",
    types: file + ".d.ts",
  }
}
await Bun.write("package.json", JSON.stringify(pkg, null, 2))

const snapshot = process.env["OPENCODE_SNAPSHOT"] === "true"

if (snapshot) {
  await $`bun publish --tag snapshot --access public`
}
if (!snapshot) {
  await $`bun publish --access public`
}
await Bun.write("package.json", JSON.stringify(original, null, 2))
