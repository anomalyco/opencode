#!/usr/bin/env bun
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { $ } from "bun"
import path from "path"

import { createClient } from "@hey-api/openapi-ts"

await $`bun dev generate > ${dir}/openapi.json`.cwd(path.resolve(dir, "../../opencode"))

const specPath = path.join(dir, "openapi.json")
const spec = JSON.parse(await Bun.file(specPath).text()) as {
  components?: {
    schemas?: {
      Agent?: {
        type?: string
        properties?: Record<string, unknown>
        required?: string[]
      }
    }
  }
}
const agent = spec.components?.schemas?.Agent
if (agent && agent.type === "object") {
  agent.properties = {
    id: { type: "string" },
    ...(agent.properties ?? {}),
  }
  agent.required = agent.required?.includes("id") ? agent.required : ["id", ...(agent.required ?? [])]
  await Bun.write(specPath, `${JSON.stringify(spec, null, 2)}\n`)
}

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
