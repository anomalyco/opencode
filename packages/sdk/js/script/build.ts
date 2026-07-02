#!/usr/bin/env bun
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { $ } from "bun"
import path from "path"

import { createClient } from "@hey-api/openapi-ts"

const opencode = path.resolve(dir, "../../opencode")
const client = path.resolve(dir, "../../client")

await $`bun dev generate > ${dir}/openapi.json`.cwd(opencode)
await $`bun -e ${`
  import { OpenApi } from "effect/unstable/httpapi"
  import { ClientApi } from "@opencode-ai/protocol/client"

  const output = process.argv.at(-1)
  if (!output) throw new Error("Missing OpenAPI output path")
  await Bun.write(output, JSON.stringify(OpenApi.fromApi(ClientApi)))
`} ${path.join(dir, "openapi-v2.json")}`.cwd(client)

const document = (await Bun.file("./openapi.json").json()) as {
  components?: { schemas?: Record<string, unknown> }
  paths?: Record<string, unknown>
  [key: string]: unknown
}
const v2Document = (await Bun.file("./openapi-v2.json").json()) as {
  components?: { schemas?: Record<string, unknown> }
  paths?: Record<string, unknown>
}
document.paths = { ...document.paths, ...v2Document.paths }
document.components = {
  ...document.components,
  schemas: { ...document.components?.schemas, ...v2Document.components?.schemas },
}
const schemas = document.components?.schemas
if (schemas) {
  const reachable = new Set<string>()
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (typeof value !== "object" || value === null) return
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref" && typeof child === "string" && child.startsWith("#/components/schemas/")) {
        const name = child.slice("#/components/schemas/".length)
        if (reachable.has(name)) continue
        reachable.add(name)
        visit(schemas[name])
      } else {
        visit(child)
      }
    }
  }
  visit({ ...document, components: { ...document.components, schemas: undefined } })
  for (const name of Object.keys(schemas)) {
    if (/^SessionNext\w+1$/.test(name) && !reachable.has(name)) delete schemas[name]
  }
  await Bun.write("./openapi.json", JSON.stringify(document))
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

const generatedTypes = await Bun.file("./src/v2/gen/types.gen.ts").text()
if (/export type SessionNext\w+1 =/.test(generatedTypes)) {
  throw new Error("Session history generated duplicate Session event variants")
}
const logTypesPatched = generatedTypes.replace(
  /(export type V2SessionLogData = \{[\s\S]*?query\?: \{\s*after\?: )string/,
  "$1number",
)
if (logTypesPatched === generatedTypes) {
  throw new Error("Session log numeric query patch did not apply")
}
await Bun.write("./src/v2/gen/types.gen.ts", logTypesPatched)

const generatedSdk = await Bun.file("./src/v2/gen/sdk.gen.ts").text()
const logSdkPatched = generatedSdk.replace(
  /(Read the session log[\s\S]*?parameters: \{[\s\S]*?after\?: )string(\s*\|\s*null)?/,
  "$1number$2",
)
if (logSdkPatched === generatedSdk) {
  throw new Error("Session log numeric SDK patch did not apply")
}
await Bun.write("./src/v2/gen/sdk.gen.ts", logSdkPatched)

// Patch a @hey-api/openapi-ts codegen bug: SseFn incorrectly passes the
// endpoint's TError into the second generic of ServerSentEventsResult, which
// is the AsyncGenerator's TReturn slot. Iterator return values have nothing
// to do with HTTP errors, and any consumer that calls `.return()` or returns
// from a mock generator gets type-checked against the wrong shape. Drop the
// arg so TReturn defaults to void.
const sseTypesPath = "./src/v2/gen/client/types.gen.ts"
const sseTypesFile = Bun.file(sseTypesPath)
const sseTypesSource = await sseTypesFile.text()
const sseTypesPatched = sseTypesSource.replace(
  "=> Promise<ServerSentEventsResult<TData, TError>>",
  "=> Promise<ServerSentEventsResult<TData>>",
)
if (sseTypesPatched === sseTypesSource) {
  throw new Error(`SseFn patch did not apply; @hey-api/openapi-ts output may have changed (${sseTypesPath})`)
}
await Bun.write(sseTypesPath, sseTypesPatched)

await $`bun prettier --write src/gen`
await $`bun prettier --write src/v2`
await $`rm -rf dist`
await $`bun tsc`
await $`rm openapi.json openapi-v2.json`
