#!/usr/bin/env bun

import { $ } from "bun"
import { fileURLToPath } from "node:url"

process.chdir(fileURLToPath(new URL("..", import.meta.url)))

await $`rm -rf dist`
await $`bun tsc -p tsconfig.build.json`
await $`bun build src/node/index.ts --outfile dist/node/index.js --target=node --format=esm --packages=external`
