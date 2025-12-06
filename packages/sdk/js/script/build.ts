#!/usr/bin/env bun

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

import { $ } from "bun"
import path from "path"
import fs from "fs/promises"

import { createClient } from "@hey-api/openapi-ts"

const stubModelsPath = path.join(dir, "models.dev.stub.json")
await Bun.write(stubModelsPath, "{}")

$.env.MODELS_DEV_API_JSON = stubModelsPath

const xdgBase = path.join(dir, ".xdg")
await Promise.all([
  fs.mkdir(xdgBase, { recursive: true }),
  fs.mkdir(path.join(xdgBase, "cache"), { recursive: true }),
  fs.mkdir(path.join(xdgBase, "config"), { recursive: true }),
  fs.mkdir(path.join(xdgBase, "state"), { recursive: true }),
  fs.mkdir(path.join(xdgBase, "log"), { recursive: true }),
])

await $`XDG_DATA_HOME=${xdgBase} XDG_CACHE_HOME=${path.join(
  xdgBase,
  "cache",
)} XDG_CONFIG_HOME=${path.join(xdgBase, "config")} XDG_STATE_HOME=${path.join(
  xdgBase,
  "state",
)} MODELS_DEV_API_JSON=${stubModelsPath} bun run --cwd ${path.resolve(
  dir,
  "../../forge",
)} src/index.ts generate > ${dir}/openapi.json`

await $`rm -rf src/gen`

await createClient({
  input: "./openapi.json",
  output: {
    path: "./src/gen",
    tsConfigPath: path.join(dir, "tsconfig.json"),
  },
  plugins: [
    {
      name: "@hey-api/typescript",
      exportFromIndex: false,
    },
    {
      name: "@hey-api/sdk",
      instance: "ForgeClient",
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
