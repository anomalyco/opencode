#!/usr/bin/env bun

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

import { $ } from "bun"

await $`bun tsc`
