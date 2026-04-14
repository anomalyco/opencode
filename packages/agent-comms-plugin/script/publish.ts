#!/usr/bin/env bun
import { Script } from "@opencode-ai/script"
import { $ } from "bun"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

await $`bun run script/build.ts`
await $`bun pm pack && npm publish *.tgz --tag ${Script.channel} --access public`
