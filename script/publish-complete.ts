#!/usr/bin/env bun

import { Script } from "@crazycode-ai/script"
import { $ } from "bun"

if (!Script.preview) {
  await $`gh release edit v${Script.version} --draft=false`
}

await $`bun install`

await $`gh release download --pattern "crazycode-linux-*64.tar.gz" --pattern "crazycode-darwin-*64.zip" -D dist`

await import(`../packages/crazycode/script/publish-registries.ts`)
