#!/usr/bin/env bun

import { $ } from "bun"

// Build SDK
await $`bun ./packages/sdk/js/script/build.ts`

// Generate openapi.json
await $`bun dev generate > ../sdk/openapi.json`.cwd("packages/opencode")

// Format
await $`./script/format.ts`
