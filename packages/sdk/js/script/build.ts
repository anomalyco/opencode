#!/usr/bin/env bun

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

import { $ } from "bun"
import path from "path"

import { createClient } from "@hey-api/openapi-ts"

await $`bun dev generate > ${dir}/openapi.json`.cwd(path.resolve(dir, "../../opencode"))

// Fix hono-openapi bug: remove serverName parameter from routes that don't need it
const openapi = await Bun.file(path.join(dir, "openapi.json")).json()
for (const [path, methods] of Object.entries(openapi.paths)) {
  if (!path.includes("{serverName}")) {
    for (const method of Object.values(methods as any)) {
      if (method.parameters) {
        method.parameters = method.parameters.filter((p: any) => p.name !== "serverName")
      }
    }
  }
}
await Bun.write(path.join(dir, "openapi.json"), JSON.stringify(openapi, null, 2))

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
