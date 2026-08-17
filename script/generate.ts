#!/usr/bin/env bun

import { $ } from "bun"

await $`bun run generate`.cwd("packages/protocol")

await $`bun run generate`.cwd("packages/www")

await $`./script/format.ts`
