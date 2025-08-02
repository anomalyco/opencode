#!/usr/bin/env bun

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

import { $ } from "bun"
import fs from "fs/promises"
import path from "path"

console.log("=== Generating JS SDK ===")
console.log()

import { createClient } from "@hey-api/openapi-ts"

await fs.rm(path.join(dir, "src/gen"), { recursive: true, force: true })
await $`bun run ../../opencode/src/index.ts generate > openapi.json`

await createClient({
  input: "./openapi.json",
  output: "./src/gen",
  plugins: [
    {
      name: "@hey-api/typescript",
      exportFromIndex: false,
    },
    {
      name: "@hey-api/sdk",
      instance: "OpencodeClient",
      exportFromIndex: false,
      auth: false,
    },
    {
      name: "@hey-api/client-fetch",
      exportFromIndex: false,
      baseUrl: "http://localhost:4096",
    },
  ],
})
await $`bun prettier --write src/gen`

await $`rm -rf dist`
await $`bun tsc`
