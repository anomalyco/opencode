#!/usr/bin/env bun

// Syncs the f5xc TUI theme from the xcsh-theme repo into the opencode source tree.
// Run this after modifying /workspace/xcsh-theme/tui/f5xc.json to update the built-in theme.
//
// Usage: bun script/sync-theme.ts

import { cpSync, existsSync } from "fs"
import { resolve } from "path"

const root = resolve(import.meta.dirname, "..")
const src = resolve(root, "../xcsh-theme/tui/f5xc.json")
const dest = resolve(root, "packages/opencode/src/cli/cmd/tui/context/theme/f5xc.json")

if (!existsSync(src)) {
  console.error(`Source not found: ${src}`)
  console.error("Ensure the xcsh-theme repo is checked out as a sibling of opencode.")
  process.exit(1)
}

cpSync(src, dest)
console.log("Synced f5xc theme -> packages/opencode/src/cli/cmd/tui/context/theme/f5xc.json")
