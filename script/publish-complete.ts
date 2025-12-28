#!/usr/bin/env node
import '../scripts/bun-shim'

import { Script } from "@opendeepseek/script"
import '../scripts/bun-shim'
const $ = (globalThis as any).Bun.$

if (!Script.preview) {
  await $`gh release edit v${Script.version} --draft=false`
}

await $`npm install`

await $`gh release download --pattern "opencode-linux-*64.tar.gz" --pattern "opencode-darwin-*64.zip" -D dist`

await import(`../packages/opendeepseek/script/publish-registries.ts`)
