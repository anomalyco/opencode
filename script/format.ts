#!/usr/bin/env node
import "../scripts/bun-shim"

import "../scripts/bun-shim"
const $ = (globalThis as any).Bun.$

await $`bun run prettier --ignore-unknown --write .`
