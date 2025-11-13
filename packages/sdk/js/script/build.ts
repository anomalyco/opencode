#!/usr/bin/env bun

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

import { $ } from "bun"
import path from "path"

import { createClient } from "@hey-api/openapi-ts"

try {
  // Generate OpenAPI spec - use Bun.spawn to properly capture stdout
  console.log("Generating OpenAPI spec...")
  const opencodeDir = path.resolve(dir, "../../opencode")
  const proc = Bun.spawn(["bun", "./src/index.ts", "generate"], {
    cwd: opencodeDir,
    stdout: "pipe",
    stderr: "pipe",
  })
  const openapiOutput = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  await proc.exited

  if (proc.exitCode !== 0) {
    console.error("Failed to generate OpenAPI spec")
    console.error(stderr)
    process.exit(1)
  }

  if (!openapiOutput || openapiOutput.length === 0) {
    console.error("OpenAPI spec is empty")
    process.exit(1)
  }

  await Bun.write(path.join(dir, "openapi.json"), openapiOutput)
  console.log("✓ Generated openapi.json")
} catch (error) {
  console.error("Error generating OpenAPI spec:", error)
  process.exit(1)
}

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

// Fix duplicate 'messages' identifier: rename session.messages.recent to session.messagesApi.recent
if (openapi.paths["/session/{id}/message/recent"]?.get) {
  openapi.paths["/session/{id}/message/recent"].get.operationId = "session.messagesApi.recent"
}

await Bun.write(path.join(dir, "openapi.json"), JSON.stringify(openapi, null, 2))
console.log("✓ Fixed OpenAPI spec")

console.log("Generating client code...")
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
console.log("✓ Generated client code")

console.log("Formatting generated code...")
await $`bun prettier --write src/gen`
console.log("✓ Formatted code")

console.log("Compiling TypeScript...")
await $`rm -rf dist`
await $`bun tsc`
console.log("✓ Build complete!")
