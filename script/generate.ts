#!/usr/bin/env bun

import { $ } from "bun"

await $`bun ./packages/sdk/js/script/build.ts`
console.log("opencode generate: sdk build complete")

await $`bun dev generate > ../sdk/openapi.json`.cwd("packages/opencode")
console.log("opencode generate: openapi export complete")

await $`./script/format.ts`
console.log("opencode generate: format complete")
console.log("opencode generate complete")
