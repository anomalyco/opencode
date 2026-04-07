#!/usr/bin/env bun
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { $ } from "bun"
import path from "path"

import { createClient } from "@hey-api/openapi-ts"

async function patchPartInputIDs(file: string) {
  let content = await Bun.file(file).text()
  if (!content.includes("export type PartIDInput = `prt${string}`")) {
    content = content.replace(
      "export type TextPartInput = {\n",
      "export type PartIDInput = `prt${string}`\n\nexport type TextPartInput = {\n",
    )
  }
  for (const name of ["TextPartInput", "FilePartInput", "AgentPartInput", "SubtaskPartInput"]) {
    content = content.replace(new RegExp(`(export type ${name} = \\{\\n)  id\\?: string`), `$1  id?: PartIDInput`)
  }
  // SessionCommandData has an inline part type with the same prt constraint
  content = content.replace(
    /(export type SessionCommandData[\s\S]*?parts\?\: Array<\{\n\s+)id\?: string/,
    "$1id?: PartIDInput",
  )
  await Bun.write(file, content)
}

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

await patchPartInputIDs("./src/v2/gen/types.gen.ts")
await $`bun prettier --write src/gen`
await $`bun prettier --write src/v2`
await $`rm -rf dist`
await $`bun tsc`
await $`rm openapi.json`
