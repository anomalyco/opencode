#!/usr/bin/env node
import { $ } from "./utils"

await $`node ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`

await $`cd ../opencode && node script/build-node.ts`
