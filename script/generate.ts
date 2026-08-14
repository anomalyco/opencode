#!/usr/bin/env bun

import { $ } from "bun"
import { generate } from "../packages/moks/src/cli/cmd/generate"

await $`bun ./packages/sdk/js/script/build.ts`

await Bun.write("packages/sdk/openapi.json", await generate())

await $`./script/format.ts`
