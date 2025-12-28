#!/usr/bin/env node
import '../scripts/bun-shim'

import '../scripts/bun-shim'
const $ = (globalThis as any).Bun.$

await $`npx tsx ./packages/sdk/js/script/build.ts`

await $`npm --workspace packages/opendeepseek run dev --silent > ../sdk/openapi.json`.cwd("packages/opendeepseek")

await $`npx tsx ./script/format.ts`
