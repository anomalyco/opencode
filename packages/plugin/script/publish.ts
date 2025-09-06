#!/usr/bin/env bun

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

import { $ } from "bun"
import { question } from "zx"

const snapshot = process.env["OPENCODE_SNAPSHOT"] === "true"

await bun tsc`

const otp = process.env["NPM_TOKEN"] ? "" : `--otp=${await question("NPM one-time password: ")}`

if (snapshot) {
  await bun publish --tag snapshot --access public ${otp}`
  await git checkout package.json`
}
if (!snapshot) {
  await bun publish --access public ${otp}`
}
