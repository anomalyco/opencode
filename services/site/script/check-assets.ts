#!/usr/bin/env bun
// Checks that the captured product screenshots are fresh: compares the manifest written by
// script/capture-assets.ts with the latest stable OpenCode release on GitHub. Run from packages/console/app:
//   bun script/check-assets.ts [--manifest public/product-assets/manifest.json] [--max-behind 3]
// Fails (exit 1) when the manifest is missing, shows an older major.minor than the latest release,
// or is more than --max-behind stable releases behind. Warns when it is behind by fewer.
import { parseArgs } from "node:util"

const args = parseArgs({
  options: {
    manifest: { type: "string", default: "public/product-assets/manifest.json" },
    "max-behind": { type: "string", default: "3" },
    repo: { type: "string", default: "anomalyco/opencode" },
  },
}).values

const file = Bun.file(args.manifest)
if (!(await file.exists())) fail(`No capture manifest at ${args.manifest}. Run script/capture-assets.ts.`)
const manifest: { opencodeVersion: string; capturedAt: string } = await file.json()

const response = await fetch(`https://api.github.com/repos/${args.repo}/releases?per_page=100`, {
  headers: {
    Accept: "application/vnd.github+json",
    ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
  },
})
if (!response.ok) fail(`GitHub releases request failed: ${response.status}`)
const releases: { tag_name: string; draft: boolean; prerelease: boolean }[] = await response.json()

// Only product releases (vX.Y.Z), newest version first. Other tags (process-daemon-v…) are skipped.
const versions = releases
  .filter((release) => !release.draft && !release.prerelease && /^v\d+\.\d+\.\d+$/.test(release.tag_name))
  .map((release) => parse(release.tag_name))
  .sort((a, b) => compare(b, a))
const latest = versions[0]
const captured = parse(manifest.opencodeVersion)
const behind = versions.filter((version) => compare(version, captured) > 0).length
const summary = `Captured from v${format(captured)} on ${manifest.capturedAt.slice(0, 10)}; latest is v${format(latest)} (${behind} release${behind === 1 ? "" : "s"} behind).`

if (captured[0] < latest[0] || (captured[0] === latest[0] && captured[1] < latest[1]))
  fail(`${summary} The latest minor version is newer: re-capture.`)
if (behind > Number(args["max-behind"])) fail(`${summary} More than ${args["max-behind"]} behind: re-capture.`)
if (behind > 0) console.warn(`warning: ${summary}`)
if (behind === 0) console.log(summary)

function parse(version: string) {
  return version.replace(/^v/, "").split(".").map(Number)
}

function compare(a: number[], b: number[]) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

function format(version: number[]) {
  return version.join(".")
}

function fail(message: string): never {
  console.error(`error: ${message}`)
  process.exit(1)
}
