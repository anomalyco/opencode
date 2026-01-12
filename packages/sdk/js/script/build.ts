#!/usr/bin/env bun

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

import { $ } from "bun"
import path from "path"
import fs from "fs/promises"

import { createClient } from "@hey-api/openapi-ts"

const patchClient = async (filepath: string, options?: { required?: boolean }) => {
  const required = options?.required ?? true
  const content = await fs.readFile(filepath, "utf8").catch(() => "")
  if (!content) {
    if (required) throw new Error(`patch target missing: ${filepath}`)
    return
  }

  const oldLines = [
    '        case "formData":',
    '        case "json":',
    '        case "text":',
    "          data = await response[parseAs]()",
    "          break",
  ]
  const newLines = [
    '        case "formData":',
    '        case "text":',
    "          data = await response[parseAs]()",
    "          break",
    '        case "json": {',
    "          const text = await response.text()",
    "          if (!text.trim()) {",
    "            data = {}",
    "          } else {",
    "            data = JSON.parse(text)",
    "          }",
    "          break",
    "        }",
  ]

  const newline = content.includes("\r\n") ? "\r\n" : "\n"
  const oldBlock = oldLines.join(newline) + newline
  const newBlock = newLines.join(newline) + newline

  if (!content.includes(oldBlock)) {
    if (required) {
      throw new Error(`patch pattern not found in ${filepath}`)
    }
    return
  }

  await fs.writeFile(filepath, content.replace(oldBlock, newBlock), "utf8")
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

await patchClient(path.join(dir, "src/v2/gen/client/client.gen.ts"))
await patchClient(path.join(dir, "src/gen/client/client.gen.ts"), { required: false })

await $`bun prettier --write src/gen`
await $`bun prettier --write src/v2`
await $`rm -rf dist`
await $`bun tsc`
await $`rm openapi.json`
