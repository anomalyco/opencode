#!/usr/bin/env bun

import { $ } from "bun"

const UPSTREAM = "upstream"
const BRANCH = "dev"

// Fetch latest upstream
console.log("Fetching upstream...")
await $`git fetch ${UPSTREAM} ${BRANCH}`

// Merge upstream
console.log("Merging upstream/dev...")
const merge = await $`git merge ${UPSTREAM}/${BRANCH}`.nothrow()
if (merge.exitCode !== 0) {
  console.log("Merge has conflicts. Resolving bun.lock from upstream...")
}

// Always take upstream lockfile
console.log("Taking upstream bun.lock...")
await $`git checkout ${UPSTREAM}/${BRANCH} -- bun.lock`

// Try frozen install first, fall back to regular install
console.log("Installing dependencies...")
const frozen = await $`bun install --frozen-lockfile`.nothrow()
if (frozen.exitCode !== 0) {
  console.log("Frozen install failed (fork deps differ from upstream). Running bun install...")
  await $`bun install`
}

// Check for leftover conflict markers
console.log("Checking for unresolved conflict markers...")
const conflicts =
  await $`grep -rn '<<<<<<' --include='*.ts' --include='*.tsx' --include='*.json' --include='*.jsonc' packages/ .scratch/ 2>/dev/null || true`.text()
if (conflicts.trim()) {
  console.log("Found conflict markers:\n" + conflicts)
} else {
  console.log("No conflict markers found.")
}

// Typecheck
console.log("Running typecheck...")
const check = await $`bun turbo typecheck`.nothrow()
if (check.exitCode !== 0) {
  console.log("Typecheck failed. Review errors above.")
  process.exit(1)
}

console.log("Upstream sync complete.")
