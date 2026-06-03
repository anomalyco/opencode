#!/usr/bin/env bun
import { $ } from "bun"

import { resolveChannel } from "./utils"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

await $`cd ../opencode && bun script/build.ts --single --skip-embed-web-ui`
await $`cd ../opencode && bun script/build-node.ts`

const binName = process.platform === "win32" ? "opencode.exe" : "opencode"
await $`mkdir -p resources/bin`
await $`cp ../opencode/dist/opencode-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}/bin/${binName} resources/bin/${binName}`
await $`chmod 755 resources/bin/${binName}`
