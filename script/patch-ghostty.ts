#!/usr/bin/env bun
/**
 * Apply patches/patch_powerline.py to the installed ghostty-web bundle.
 *
 * Wired into the root `postinstall` lifecycle so every `bun install` (which
 * reinstates ghostty-web from cache) re-applies the Canvas2D powerline +
 * cell-metric fixes. The patch script itself is idempotent.
 */

import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const target = resolve(root, "packages/app/node_modules/ghostty-web/dist/ghostty-web.js")
const patcher = resolve(root, "patches/patch_powerline.py")

if (!existsSync(target)) {
  console.log(`[patch-ghostty] ${target} not found, skipping`)
  process.exit(0)
}

const result = spawnSync("python3", [patcher, target], {
  stdio: "inherit",
  cwd: root,
})

if (result.error) {
  console.error("[patch-ghostty] failed to spawn python3:", result.error.message)
  process.exit(0)
}

process.exit(result.status ?? 0)
