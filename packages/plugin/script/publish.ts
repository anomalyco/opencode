#!/usr/bin/env bun

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

import { $ } from "bun"

await $`bun tsc`

const pkg = await import("../package.json")
for (const [key, value] of Object.entries(pkg.exports)) {
  const file = value.replace("./src/", "./").replace(".ts", "")
  // @ts-expect-error
  pkg.exports[key] = {
    import: file + ".js",
    types: file + ".d.ts",
  }
}
await Bun.write("./dist/package.json", JSON.stringify(pkg, null, 2))

const snapshot = process.env["OPENCODE_SNAPSHOT"] === "true"

if (snapshot) {
  await $`bun publish --tag snapshot --access public`.cwd("./dist")
}
if (!snapshot) {
  await $`bun publish --access public`.cwd("./dist")
}
