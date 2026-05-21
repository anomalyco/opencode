#!/usr/bin/env node
import { $ } from "./utils"

import { resolveChannel } from "./utils"

const channel = resolveChannel()
await $`node ./scripts/copy-icons.ts ${channel}`
await $`node ./scripts/copy-metainfo.ts ${channel}`

await $`cd ../opencode && node script/build-node.ts`
