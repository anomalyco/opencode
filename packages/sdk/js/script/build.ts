#!/usr/bin/env bun

import { fileURLToPath } from "node:url"
import path from "path"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const dir = path.resolve(scriptDir, "..")
process.chdir(dir)

import { $ } from "bun"

import { createClient } from "@hey-api/openapi-ts"

await $`bun dev generate > ${path.join(dir, "openapi.json")}`.cwd(path.resolve(dir, "../../opencode"))

await createClient({
  input: "./openapi.json",
  output: {
    path: "./src/v2/gen",
    tsConfigPath: path.join(dir, "tsconfig.json"),
    clean: true,
  },
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
      paramsStructure: "flat",
    },
    {
      name: "@hey-api/client-fetch",
      exportFromIndex: false,
      baseUrl: "http://localhost:4096",
    },
  ],
})

await $`bun prettier --write src/gen`
await $`bun prettier --write src/v2`
await $`rm -rf dist`
await $`bun tsc`
await $`rm openapi.json`
