#!/usr/bin/env node
import "../scripts/bun-shim"

import "../scripts/bun-shim"
const $ = (globalThis as any).Bun.$

await $`bun ./packages/sdk/js/script/build.ts`

await $`bun dev generate > ../sdk/openapi.json`.cwd("packages/opendeepseek")

await $`./script/format.ts`
