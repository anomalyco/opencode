#!/usr/bin/env bun

import { $ } from "bun"
import { parseArgs } from "util"
import { getLatestRelease } from "./changelog"

const paths = [
  "packages/opencode",
  "packages/sdk",
  "packages/plugin",
  "packages/desktop",
  "packages/app",
  "sdks/vscode",
  "packages/extensions",
  "github",
]

const clean = (text: string) => text.split("\n").filter(Boolean)

const ref = (value: string, head = false) => {
  if (head && value === "HEAD") return value
  if (value.startsWith("v")) return value
  return `v${value}`
}

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    from: { type: "string", short: "f" },
    to: { type: "string", short: "t", default: "HEAD" },
    base: { type: "string", short: "b", default: "origin/dev" },
    help: { type: "boolean", short: "h", default: false },
  },
})

if (values.help) {
  console.log(`
Usage: bun script/changelog-debug.ts [options]

Options:
  -f, --from <version>   Starting version (default: latest GitHub release)
  -t, --to <ref>         Ending ref (default: HEAD)
  -b, --base <ref>       Compare base for ahead/behind (default: origin/dev)
  -h, --help             Show this help message

Examples:
  bun script/changelog-debug.ts
  bun script/changelog-debug.ts -f 1.0.200 -t dev
  bun script/changelog-debug.ts -f 1.0.200 -t HEAD -b origin/dev
`)
  process.exit(0)
}

const to = values.to!
const from = values.from ?? (await getLatestRelease())
const fromRef = ref(from)
const toRef = ref(to, true)

console.log(`Debugging changelog range: ${fromRef} -> ${toRef}\n`)

const [ahead, behind] = await $`git rev-list --left-right --count ${values.base}...HEAD`
  .text()
  .then((text) => text.trim().split("\t"))

console.log(`Ahead/behind ${values.base}: ahead=${ahead ?? "0"} behind=${behind ?? "0"}`)

const gh = await $`gh api "/repos/anomalyco/opencode/compare/${fromRef}...${toRef}" --jq '.commits[].sha'`
  .text()
  .then(clean)

const localAll = await $`git log ${fromRef}..${toRef} --oneline --format="%H"`.text().then(clean)
const localFiltered = await $`git log ${fromRef}..${toRef} --oneline --format="%H" -- ${paths}`.text().then(clean)

const ghSet = new Set(gh)
const missing = localFiltered.filter((hash) => !ghSet.has(hash))

console.log(`GitHub compare commits: ${gh.length}`)
console.log(`Local commits (all): ${localAll.length}`)
console.log(`Local commits (filtered paths): ${localFiltered.length}`)
console.log(`Filtered commits missing from GitHub compare: ${missing.length}`)

if (missing.length > 0) {
  console.log("\nMissing hashes (first 10):")
  console.log(missing.slice(0, 10).join("\n"))
}
