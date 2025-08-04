#!/usr/bin/env bun

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

import { $ } from "bun"

await import("./generate")
await $`rm -rf dist`
await $`bun tsc`

const snapshot = process.env["OPENCODE_SNAPSHOT"] === "true"

if (snapshot) {
  await $`bun publish --tag snapshot`
}
if (!snapshot) {
  await $`bun publish`
}
