#!/usr/bin/env bun

import { $ } from "bun"

await $`bun ./script/generate-from-schemas.ts`

await $`bun ./packages/sdk/js/script/build.ts`

await $`bun dev generate > ../sdk/openapi.json`.cwd("packages/opencode")

await $`./script/format.ts`
