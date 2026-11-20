#!/usr/bin/env bun

import { $ } from "bun"
import { fileURLToPath } from "node:url"

process.chdir(fileURLToPath(new URL("..", import.meta.url)))

await $`bun run script/generate.ts`
await $`rm -rf dist`
await $`bun tsc -p tsconfig.build.json`
