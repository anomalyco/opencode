#!/usr/bin/env bun

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

import { $ } from "bun"
import { question } from "zx"

await import("./generate")
await rm -rf dist`
await bun tsc`

const snapshot = process.env["OPENCODE_SNAPSHOT"] === "true"
const otp = process.env["NPM_TOKEN"] ? "" : `--otp=${await question("NPM one-time password: ")}`

if (snapshot) {
  await bun publish --tag snapshot ${otp}`
}
if (!snapshot) {
  await bun publish ${otp}`
}
