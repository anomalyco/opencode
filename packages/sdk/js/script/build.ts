#!/usr/bin/env bun

import { fileURLToPath } from "url"
import path from "path"
import { $ } from "bun"

const dir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(dir, "..")
process.chdir(rootDir)

import { createClient } from "@hey-api/openapi-ts"

await $`bun dev generate > ${rootDir}/openapi.json`.cwd(path.resolve(rootDir, "../../opencode"))

await createClient({
  input: "./openapi.json",
  output: {
    path: "./src/gen",
    tsConfigPath: path.join(rootDir, "tsconfig.json"),
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
