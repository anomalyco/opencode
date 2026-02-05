#!/usr/bin/env bun
/**
 * Check for circular dependencies in the source code.
 * Usage: bun run script/check-circular-deps.ts
 */

import { $ } from "bun"
import * as path from "path"

const srcDir = path.join(import.meta.dir, "../src")

// Use madge if available, otherwise fall back to dpdm
async function checkWithMadge() {
  try {
    const result = await $`npx madge --circular --extensions ts ${srcDir}`.quiet()
    const output = result.stdout.toString()
    if (output.trim()) {
      console.error("❌ Circular dependencies found:")
      console.error(output)
      process.exit(1)
    } else {
      console.log("✅ No circular dependencies found")
    }
  } catch (e: any) {
    if (e.stdout?.toString().trim()) {
      console.error("❌ Circular dependencies found:")
      console.error(e.stdout.toString())
      process.exit(1)
    }
    // madge might not be installed, try dpdm
    await checkWithDpdm()
  }
}

async function checkWithDpdm() {
  try {
    const result = await $`npx dpdm --circular --no-tree --no-warning ${srcDir}/index.ts`.quiet()
    const output = result.stdout.toString()
    if (output.includes("Circular")) {
      console.error("❌ Circular dependencies found:")
      console.error(output)
      process.exit(1)
    } else {
      console.log("✅ No circular dependencies found (dpdm)")
    }
  } catch {
    console.warn("⚠️ Neither madge nor dpdm available. Install with: bun add -D madge")
  }
}

await checkWithMadge()
