#!/usr/bin/env bun

import path from "node:path"
import { fileURLToPath } from "node:url"
import { $ } from "bun"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const sdkOpenapi = path.join(root, "packages/sdk/openapi.json")

await $`bun ./packages/sdk/js/script/build.ts`

await $`bun run dev generate --openapi-out ${sdkOpenapi}`.cwd(path.join(root, "packages/opencode"))

await $`./script/format.ts`
