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
    clean: true,
    indexFile: false,
    path: "./src/v2/gen",
    source: {
      fileName: 'openapi',
    },
    tsConfigPath: path.join(dir, "tsconfig.json"),
  },
  plugins: [
    {
      baseUrl: "http://localhost:4096",
      name: "@hey-api/client-fetch",
    },
    "@hey-api/typescript",
    {
      auth: false,
      examples: {
        importSetup(ctx) {
          const { $, node } = ctx;
          return $(node.name).call();
        },
        importName: 'createOpencodeClient',
        moduleName: '@opencode-ai/sdk',
        payload(operation, ctx) {
          const { $ } = ctx;
          return $.object().pretty();
        },
        transform: (example) => example.replace(/\({}\)/, '({\n  ...\n})'),
        setupName: 'client',
      },
      name: "@hey-api/sdk",
      operations: {
        containerName: "OpencodeClient",
        strategy: "single",
      },
      paramsStructure: "flat",
    },
  ],
})

await $`bun prettier --write src/gen`
await $`bun prettier --write src/v2`
await $`rm -rf dist`
await $`bun tsc`
await $`rm openapi.json`
