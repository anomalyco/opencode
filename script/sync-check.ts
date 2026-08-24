#!/usr/bin/env bun
/**
 * sync-check — turn the "new version available" signal into a rebase flow.
 *
 * The in-app updater now points at the fork (see src/fork/distribution.ts), so
 * it tells you about OUR releases. This script is the other half: it asks
 * whether UPSTREAM has moved past the commit we last synced (manifest baseline)
 * and, if so, kicks off the controlled sync — instead of letting an update
 * prompt clobber the binary.
 *
 *   bun run sync:check            # report only
 *   bun run sync:check --apply    # also scaffold the sync worktree (sync-upstream.ts --apply)
 *
 * It never merges into dev or pushes on its own — it stops at a prepared,
 * conflict-resolvable worktree and prints the remaining steps.
 */
import fs from "fs"
import path from "path"

const root = path.resolve(import.meta.dir, "..")
const apply = Bun.argv.includes("--apply")

type Manifest = {
  upstreamRemote: string
  baseline: { upstreamRef: string; upstreamBranch: string }
}
const manifest: Manifest = JSON.parse(fs.readFileSync(path.join(root, "fork", "manifest.json"), "utf8"))
const upstreamBranch = manifest.baseline.upstreamBranch || "upstream/dev"
const baseRef = manifest.baseline.upstreamRef

async function git(args: string[], opts: { capture?: boolean } = {}) {
  const proc = Bun.spawn(["git", ...args], {
    cwd: root,
    stdout: opts.capture ? "pipe" : "inherit",
    stderr: opts.capture ? "pipe" : "inherit",
  })
  const out = opts.capture ? (await new Response(proc.stdout).text()).trim() : ""
  const code = await proc.exited
  if (code !== 0 && !opts.capture) throw new Error(`git ${args.join(" ")} failed (${code})`)
  return { code, out }
}

console.log(`Upstream:  ${manifest.upstreamRemote} (${upstreamBranch})`)
console.log(`Baseline:  ${baseRef.slice(0, 12)} (last synced into dev)\n`)

console.log("Fetching upstream…")
await git(["fetch", "upstream", "--prune"])

const tip = (await git(["rev-parse", upstreamBranch], { capture: true })).out
const ahead = (await git(["rev-list", "--count", `${baseRef}..${upstreamBranch}`], { capture: true })).out
const aheadN = Number.parseInt(ahead || "0", 10)

if (!aheadN) {
  console.log(`✓ Up to date — ${upstreamBranch} (${tip.slice(0, 12)}) is not ahead of baseline.`)
  process.exit(0)
}

console.log(`⇧ Upstream is ${aheadN} commit(s) ahead. New commits:\n`)
const logOut = (await git(["log", "--oneline", "--no-decorate", "-15", `${baseRef}..${upstreamBranch}`], { capture: true })).out
console.log(logOut.split("\n").map((l) => "    " + l).join("\n"))

if (!apply) {
  console.log(`\nA sync is due. Re-run with --apply to scaffold the worktree, or:`)
  console.log(`    bun run sync-upstream:apply`)
  process.exit(0)
}

console.log(`\nScaffolding sync worktree…\n`)
await git(["fetch", "origin", "--prune"]) // sync-upstream.ts re-fetches but harmless
const r = await new Promise<number>((resolve) => {
  const proc = Bun.spawn(["bun", "script/sync-upstream.ts", "--apply"], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  })
  proc.exited.then(resolve)
})
if (r !== 0) process.exit(r)

console.log(`\nNext steps (in the new worktree):`)
console.log(`    1. resolve conflicts`)
console.log(`    2. bun install && (cd packages/opencode && bun typecheck)`)
console.log(`    3. bun run fork:verify        # confirm no fork feature was dropped`)
console.log(`    4. merge the sync branch back into dev`)
console.log(`    5. bump fork/manifest.json baseline.upstreamRef -> ${tip.slice(0, 12)} and re-tag`)
process.exit(0)
