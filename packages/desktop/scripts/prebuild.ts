#!/usr/bin/env bun
import path from "node:path"
import { $ } from "bun"

import { downloadCliToResources, resolveChannel } from "./utils"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

const opencodeDir = path.resolve(import.meta.dir, "../../opencode")
await $`bun ./script/build-node.ts`.cwd(opencodeDir)
if (channel === "dev") await downloadCliToResources()
