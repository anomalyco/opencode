#!/usr/bin/env bun

import { $ } from "bun"

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

const snapshot = process.env["OPENCODE_SNAPSHOT"] === "true"

if (snapshot) {
  await $`bun publish --tag snapshot`
} else {
  await $`bun publish`
}
