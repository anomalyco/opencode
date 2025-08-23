#!/usr/bin/env bun

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

import { $ } from "bun"

await import("./generate")
await $`rm -rf dist`
await $`bun tsc`
