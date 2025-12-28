#!/usr/bin/env node
import '../scripts/bun-shim'

import '../scripts/bun-shim'
const $ = (globalThis as any).Bun.$

await $`npx prettier --ignore-unknown --write .`
