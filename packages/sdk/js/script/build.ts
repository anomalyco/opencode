#!/usr/bin/env bun

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

import { $ } from "bun"
import path from "path"

import { createClient } from "@hey-api/openapi-ts"

await $`bun dev generate > ${dir}/openapi.json`.cwd(path.resolve(dir, "../../opencode"))

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

// Fix SSE reconnection: change unconditional break to conditional break
// This allows the SSE client to automatically reconnect when the server restarts
// See: .kb/investigations/2026-01-28-inv-sse-reconnection-opencode-client-survive.md
const sseFile = path.join(dir, "src/v2/gen/core/serverSentEvents.gen.ts")
const content = await Bun.file(sseFile).text()
// Match "break // exit loop on normal completion" and replace with conditional break
const fixed = content.replace(
  /\n\s+break \/\/ exit loop on normal completion/,
  "\n        // Only exit retry loop if explicitly aborted, otherwise reconnect\n        if (signal.aborted) break"
)
await Bun.write(sseFile, fixed)

await $`rm -rf dist`
await $`bun tsc`
await $`rm openapi.json`
