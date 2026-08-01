#!/usr/bin/env bun

import { resolve } from "path"
import { fileURLToPath } from "url"

const __dirname = resolve(fileURLToPath(import.meta.url), "..")

export interface RebaseCheckResult {
  status: "current" | "fast-forward" | "clean" | "conflicts" | "type-errors"
  ahead: number
  behind: number
  conflicts: string[]
  compileErrors: string[]
}

async function checkRebase(json = false): Promise<RebaseCheckResult> {
  const origin = (await Bun.$`git remote get-url origin`.nothrow().quiet()).text().trim()
  const isFork = !origin.includes("anomalyco/opencode")

  const upstream = isFork ? "anomalyco/opencode.git" : undefined
  if (upstream) {
    await Bun.$`git remote add upstream git@github.com:${upstream}`.nothrow()
    await Bun.$`git fetch upstream dev --quiet`.nothrow()
  }

  const upstreamBranch = upstream ? "upstream/dev" : "origin/dev"

  const mergeBase = (await Bun.$`git merge-base HEAD ${upstreamBranch}`.nothrow().quiet()).text().trim()
  const behindLog = (await Bun.$`git log --oneline ${mergeBase}..${upstreamBranch}`.nothrow().quiet()).text()
  const aheadLog = (await Bun.$`git log --oneline ${mergeBase}..HEAD`.nothrow().quiet()).text()

  const behind = behindLog.split("\n").filter(Boolean).length
  const ahead = aheadLog.split("\n").filter(Boolean).length

  if (behind === 0) {
    return { status: "current", ahead, behind, conflicts: [], compileErrors: [] }
  }

  if (ahead === 0) {
    return { status: "fast-forward", ahead, behind, conflicts: [], compileErrors: [] }
  }

  // Find file-level overlap
  const ourFilesText = (await Bun.$`git diff --name-only ${mergeBase}..HEAD`.nothrow().quiet()).text()
  const upstreamFilesText = (await Bun.$`git diff --name-only ${mergeBase}..${upstreamBranch}`.nothrow().quiet()).text()

  const ourFiles = new Set(ourFilesText.split("\n").filter(Boolean))
  const upstreamFiles = upstreamFilesText.split("\n").filter(Boolean)
  const overlapping = upstreamFiles.filter((f) => ourFiles.has(f))

  // Check merge conflicts via merge-tree
  let hasConflicts = false
  try {
    const mergeCheck = await Bun.$`git merge-tree --write-tree ${upstreamBranch} HEAD`
      .nothrow()
      .quiet()
    hasConflicts = mergeCheck.text().includes("<<<<<<<")
  } catch {}

  // Compile check on merge result
  let compileErrors: string[] = []
  const currentBranch = (await Bun.$`git branch --show-current`.nothrow().quiet().text()).trim()

  if (!hasConflicts) {
    const tempBranch = `check-update-${Date.now()}`
    try {
      await Bun.$`git checkout -b ${tempBranch} ${upstreamBranch}`.nothrow().quiet()
      const mergeResult = await Bun.$`git merge HEAD@{1} --no-edit`.nothrow()
      if (mergeResult.exitCode === 0) {
        const pkgDir = new URL("../packages/core", import.meta.url).pathname
        const tc = await Bun.$`bun run typecheck`.cwd(pkgDir).nothrow()
        if (tc.exitCode !== 0) {
          compileErrors = tc.text().split("\n").filter((l: string) => /^src\//.test(l))
        }
      }
    } catch {
    } finally {
      await Bun.$`git checkout ${currentBranch}`.nothrow().quiet()
      await Bun.$`git branch -D ${tempBranch}`.nothrow().quiet()
    }
  }

  if (hasConflicts) {
    return { status: "conflicts", ahead, behind, conflicts: overlapping, compileErrors }
  }

  if (compileErrors.length > 0) {
    return { status: "type-errors", ahead, behind, conflicts: overlapping, compileErrors }
  }

  return { status: "clean", ahead, behind, conflicts: overlapping, compileErrors: [] }
}

function log(msg: string, json = false) {
  if (!json) console.log(msg)
}

async function main() {
  const [, , ...args] = process.argv
  const json = args.includes("--json")

  const result = await checkRebase(json)

  if (result.status === "current") {
    if (json) console.log(JSON.stringify(result))
    else console.log("Already up to date.")
    process.exit(3)
  }

  if (result.status === "fast-forward") {
    if (json) console.log(JSON.stringify(result))
    else {
      console.log("No local changes — fast-forward is clean.")
      console.log(`${result.behind} upstream commits to pull:`)
    }
    process.exit(0)
  }

  log("", json)
  log(`Custom branch ahead: ${result.ahead}`, json)
  log(`Upstream behind:   ${result.behind}`, json)
  log(`Overlapping files: ${result.conflicts.length}`, json)
  for (const f of result.conflicts) log(`  - ${f}`, json)
  log("", json)

  if (result.status === "conflicts") {
    if (json) console.log(JSON.stringify(result))
    else {
      console.log("MERGE CONFLICTS DETECTED:")
      for (const f of result.conflicts.slice(0, 20)) console.log(`  ${f}`)
      console.log(`\nRebase needed: git rebase ${upstreamBranch}`)
    }
    process.exit(2)
  }

  if (result.status === "type-errors") {
    if (json) console.log(JSON.stringify(result))
    else {
      console.log("No merge conflicts, but typecheck failed:")
      for (const l of result.compileErrors) console.log(`  ${l}`)
    }
    process.exit(1)
  }

  if (json) console.log(JSON.stringify(result))
  else {
    console.log("Clean — rebase should apply without issues.")
    console.log(`${result.behind} upstream commits to pull:`)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error("Error:", e.message)
  process.exit(1)
})

export { checkRebase, type RebaseCheckResult }