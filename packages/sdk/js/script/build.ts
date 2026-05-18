#!/usr/bin/env bun
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { $ } from "bun"
import path from "path"

import { createClient } from "@hey-api/openapi-ts"

const opencode = path.resolve(dir, "../../opencode")

async function hardenGeneratedParams() {
  for (const file of ["src/gen/core/params.gen.ts", "src/v2/gen/core/params.gen.ts"]) {
    let source = await Bun.file(file).text()

    if (!source.includes("const getParamSlot =")) {
      source = source.replace(
        /const extraPrefixes = Object\.entries\(extraPrefixesMap\)\n+/,
        `const extraPrefixes = Object.entries(extraPrefixesMap)
const getParamSlot = (slot: unknown): Slot | undefined => {
  switch (slot) {
    case "body":
    case "headers":
    case "path":
    case "query":
      return slot
    default:
      return undefined
  }
}
`,
      )
    }

    source = source
      .replace(
        `if (config.key) {
        map.set(config.key, {
          in: config.in,`,
        `const slot = getParamSlot(config.in)
      if (config.key && slot) {
        map.set(config.key, {
          in: slot,`,
      )
      .replace(
        `} else if ("key" in config) {
      map.set(config.key, {
        map: config.map,
      })`,
        `} else if ("key" in config) {
      const slot = getParamSlot(config.map)
      if (slot) {
        map.set(config.key, {
          map: slot,
        })
      }`,
      )
      .replaceAll(
        `const field = map.get(config.key)!
        const name = field.map || config.key`,
        `const field = map.get(config.key)
        if (!field) {
          continue
        }
        const name = field.map || config.key`,
      )
      .replaceAll(
        `} else {
        params.body = arg`,
        `} else if (getParamSlot(config.in) === "body") {
        params.body = arg`,
      )
      .replaceAll(
        `if (allowed) {
                ;(params[slot as Slot] as Record<string, unknown>)[key] = value`,
        `const paramSlot = getParamSlot(slot)
              if (allowed && paramSlot) {
                ;(params[paramSlot] as Record<string, unknown>)[key] = value`,
      )

    if (source.includes("getParamSlot") && !source.includes("const getParamSlot =")) {
      throw new Error(`failed to inject parameter slot guard into ${file}`)
    }

    await Bun.write(file, source)
  }
}

await $`bun dev generate > ${dir}/openapi.json`.cwd(opencode)

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
await hardenGeneratedParams()
await $`bun prettier --write src/gen/core/params.gen.ts src/v2/gen/core/params.gen.ts`
await $`rm -rf dist`
await $`bun tsc`
await $`rm openapi.json`
