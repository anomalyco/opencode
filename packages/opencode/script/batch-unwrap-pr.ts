#!/usr/bin/env bun
/**
 * Automate the full per-file namespace→self-reexport migration:
 *
 *   1. Create a worktree at ../opencode-worktrees/ns-<slug> on a new branch
 *      `kit/ns-<slug>` off `origin/dev`.
 *   2. Symlink `node_modules` from the main repo into the worktree root so
 *      builds work without a fresh `bun install`.
 *   3. Run `script/unwrap-and-self-reexport.ts` on the target file inside the worktree.
 *   4. Verify:
 *        - `bunx --bun tsgo --noEmit` (pre-existing plugin.ts cross-worktree
 *          noise ignored — we compare against a pre-change baseline captured
 *          via `git stash`, so only NEW errors fail).
 *        - `bun run --conditions=browser ./src/index.ts generate`.
 *        - Relevant tests under `test/<dir>` if that directory exists.
 *   5. Commit, push with `--no-verify`, and open a PR titled after the
 *      namespace.
 *
 * Usage:
 *
 *   bun script/batch-unwrap-pr.ts src/file/ignore.ts
 *   bun script/batch-unwrap-pr.ts src/file/ignore.ts src/file/watcher.ts   # multiple
 *   bun script/batch-unwrap-pr.ts --dry-run src/file/ignore.ts             # plan only
 *
 * Repo assumptions:
 *
 *   - Main checkout at /Users/kit/code/open-source/opencode (configurable via
 *     --repo-root=...).
 *   - Worktree root at /Users/kit/code/open-source/opencode-worktrees
 *     (configurable via --worktree-root=...).
 *
 * The script does NOT enable auto-merge; that's a separate manual step if we
 * want it.
 */

import fs from "node:fs"
import path from "node:path"
import { spawnSync, type SpawnSyncReturns } from "node:child_process"

type Cmd = string[]

function run(
  cwd: string,
  cmd: Cmd,
  opts: { capture?: boolean; allowFail?: boolean; stdin?: string } = {},
): SpawnSyncReturns<string> {
  const result = spawnSync(cmd[0], cmd.slice(1), {
    cwd,
    stdio: opts.capture ? ["pipe", "pipe", "pipe"] : ["inherit", "inherit", "inherit"],
    encoding: "utf-8",
    input: opts.stdin,
  })
  if (!opts.allowFail && result.status !== 0) {
    const label = `${path.basename(cmd[0])} ${cmd.slice(1).join(" ")}`
    console.error(`[fail] ${label} (cwd=${cwd})`)
    if (opts.capture) {
      if (result.stdout) console.error(result.stdout)
      if (result.stderr) console.error(result.stderr)
    }
    process.exit(result.status ?? 1)
  }
  return result
}

function fileSlug(fileArg: string): string {
  // src/file/ignore.ts → file-ignore
  return fileArg
    .replace(/^src\//, "")
    .replace(/\.tsx?$/, "")
    .replace(/[\/_]/g, "-")
}

function readNamespace(absFile: string): string {
  const content = fs.readFileSync(absFile, "utf-8")
  const match = content.match(/^export\s+namespace\s+(\w+)\s*\{/m)
  if (!match) {
    console.error(`no \`export namespace\` found in ${absFile}`)
    process.exit(1)
  }
  return match[1]
}

// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const repoRoot = (
  args.find((a) => a.startsWith("--repo-root=")) ?? "--repo-root=/Users/kit/code/open-source/opencode"
).split("=")[1]
const worktreeRoot = (
  args.find((a) => a.startsWith("--worktree-root=")) ?? "--worktree-root=/Users/kit/code/open-source/opencode-worktrees"
).split("=")[1]
const targets = args.filter((a) => !a.startsWith("--"))

if (targets.length === 0) {
  console.error("Usage: bun script/batch-unwrap-pr.ts <src/path.ts> [more files...] [--dry-run]")
  process.exit(1)
}

if (!fs.existsSync(worktreeRoot)) fs.mkdirSync(worktreeRoot, { recursive: true })

for (const rel of targets) {
  const absSrc = path.join(repoRoot, "packages", "opencode", rel)
  if (!fs.existsSync(absSrc)) {
    console.error(`skip ${rel}: file does not exist under ${repoRoot}/packages/opencode`)
    continue
  }
  const slug = fileSlug(rel)
  const branch = `kit/ns-${slug}`
  const wt = path.join(worktreeRoot, `ns-${slug}`)
  const ns = readNamespace(absSrc)

  console.log(`\n=== ${rel} → ${ns} (branch=${branch} wt=${path.basename(wt)}) ===`)

  if (dryRun) {
    console.log(`  would create worktree ${wt}`)
    console.log(`  would run unwrap on packages/opencode/${rel}`)
    console.log(`  would commit, push, and open PR`)
    continue
  }

  // Sync dev (fetch only; we branch off origin/dev directly).
  run(repoRoot, ["git", "fetch", "origin", "dev", "--quiet"])

  // Create worktree + branch.
  if (fs.existsSync(wt)) {
    console.log(`  worktree already exists at ${wt}; skipping`)
    continue
  }
  run(repoRoot, ["git", "worktree", "add", "-b", branch, wt, "origin/dev"])

  // Symlink node_modules so bun/tsgo work without a full install.
  // We link both the repo root and packages/opencode, since the opencode
  // package has its own local node_modules (including bunfig.toml preload deps
  // like @opentui/solid) that aren't hoisted to the root.
  const wtRootNodeModules = path.join(wt, "node_modules")
  if (!fs.existsSync(wtRootNodeModules)) {
    fs.symlinkSync(path.join(repoRoot, "node_modules"), wtRootNodeModules)
  }
  const wtOpencode = path.join(wt, "packages", "opencode")
  const wtOpencodeNodeModules = path.join(wtOpencode, "node_modules")
  if (!fs.existsSync(wtOpencodeNodeModules)) {
    fs.symlinkSync(path.join(repoRoot, "packages", "opencode", "node_modules"), wtOpencodeNodeModules)
  }
  const wtTarget = path.join(wt, "packages", "opencode", rel)

  // Baseline tsgo output (pre-change).
  const baselinePath = path.join(wt, ".ns-baseline.txt")
  const baseline = run(wtOpencode, ["bunx", "--bun", "tsgo", "--noEmit"], { capture: true, allowFail: true })
  fs.writeFileSync(baselinePath, (baseline.stdout ?? "") + (baseline.stderr ?? ""))

  // Run the unwrap script from the MAIN repo checkout (where the tooling
  // lives) targeting the worktree's file by absolute path. We run from the
  // worktree root (not `packages/opencode`) to avoid triggering the
  // bunfig.toml preload, which needs `@opentui/solid` that only the TUI
  // workspace has installed.
  const unwrapScript = path.join(repoRoot, "packages", "opencode", "script", "unwrap-and-self-reexport.ts")
  run(wt, ["bun", unwrapScript, wtTarget])

  // Post-change tsgo.
  const after = run(wtOpencode, ["bunx", "--bun", "tsgo", "--noEmit"], { capture: true, allowFail: true })
  const afterText = (after.stdout ?? "") + (after.stderr ?? "")

  // Compare line-sets to detect NEW tsgo errors.
  const sanitize = (s: string) =>
    s
      .split("\n")
      .map((l) => l.replace(/\s+$/, ""))
      .filter(Boolean)
      .sort()
      .join("\n")
  const baselineSorted = sanitize(fs.readFileSync(baselinePath, "utf-8"))
  const afterSorted = sanitize(afterText)
  if (baselineSorted !== afterSorted) {
    console.log(`  tsgo output differs from baseline. Showing diff:`)
    const diffResult = spawnSync("diff", ["-u", baselinePath, "-"], { input: afterText, encoding: "utf-8" })
    if (diffResult.stdout) console.log(diffResult.stdout)
    if (diffResult.stderr) console.log(diffResult.stderr)
    console.error(`  aborting ${rel}; investigate manually in ${wt}`)
    process.exit(1)
  }

  // SDK build.
  run(wtOpencode, ["bun", "run", "--conditions=browser", "./src/index.ts", "generate"], { capture: true })

  // Run tests for the directory, if a matching test dir exists.
  const dirName = path.basename(path.dirname(rel))
  const testDir = path.join(wt, "packages", "opencode", "test", dirName)
  if (fs.existsSync(testDir)) {
    const testResult = run(wtOpencode, ["bun", "run", "test", `test/${dirName}`], { capture: true, allowFail: true })
    const combined = (testResult.stdout ?? "") + (testResult.stderr ?? "")
    if (testResult.status !== 0) {
      console.error(combined)
      console.error(`  tests failed for ${rel}; aborting`)
      process.exit(1)
    }
    // Surface the summary line if present.
    const summary = combined
      .split("\n")
      .filter((l) => /\bpass\b|\bfail\b/.test(l))
      .slice(-3)
      .join("\n")
    if (summary) console.log(`  tests: ${summary.replace(/\n/g, " | ")}`)
  } else {
    console.log(`  tests: no test/${dirName} directory, skipping`)
  }

  // Clean up baseline file before committing.
  fs.unlinkSync(baselinePath)

  // Commit, push, open PR.
  const commitMsg = `refactor: unwrap ${ns} namespace + self-reexport`
  run(wt, ["git", "add", "-A"])
  run(wt, ["git", "commit", "-m", commitMsg])
  run(wt, ["git", "push", "-u", "origin", branch, "--no-verify"])

  const prBody = [
    "## Summary",
    `- Unwrap the \`${ns}\` namespace in \`packages/opencode/${rel}\` to flat top-level exports.`,
    `- Append \`export * as ${ns} from "./${path.basename(rel, ".ts")}"\` so consumers keep the same \`${ns}.x\` import ergonomics.`,
    "",
    "## Verification (local)",
    "- `bunx --bun tsgo --noEmit` — no new errors vs baseline.",
    "- `bun run --conditions=browser ./src/index.ts generate` — clean.",
    `- \`bun run test test/${dirName}\` — all pass (if applicable).`,
  ].join("\n")
  run(wt, ["gh", "pr", "create", "--title", commitMsg, "--base", "dev", "--body", prBody])

  console.log(`  PR opened for ${rel}`)
}
