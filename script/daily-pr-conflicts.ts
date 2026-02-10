#!/usr/bin/env bun

import { $ } from "bun"

interface PR {
  number: number
  title: string
  headRefName: string
  baseRefName: string
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN"
}

interface ConflictInfo {
  path: string
  lines: string[]
}

async function fetchPRs(): Promise<PR[]> {
  const result = await $`gh pr list --state open --json number,title,headRefName,baseRefName,mergeable`.quiet()
  const prs = JSON.parse(result.stdout.toString()) as PR[]
  return prs.filter((pr) => pr.mergeable !== "UNKNOWN")
}

async function updateBranch(prNumber: number): Promise<boolean> {
  try {
    await $`gh pr update-branch ${prNumber.toString()}`.quiet()
    return true
  } catch {
    return false
  }
}

async function getConflictDetails(pr: PR): Promise<ConflictInfo[]> {
  const conflicts: ConflictInfo[] = []
  const prBranch = `pr-${pr.number}`

  try {
    await $`git fetch origin pull/${pr.number}/head:${prBranch}`.quiet()

    const baseResult = await $`git merge-base origin/${pr.baseRefName} ${prBranch}`.quiet()
    const mergeBase = baseResult.stdout.toString().trim()

    const mergeResult = await $`git merge-tree ${mergeBase} origin/${pr.baseRefName} ${prBranch}`.nothrow().quiet()
    const output = mergeResult.stdout.toString()

    if (output.includes("conflict") || mergeResult.exitCode !== 0) {
      const lines = output.split("\n")
      let currentFile = ""
      let conflictLines: string[] = []

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]

        if (line.startsWith("added in both")) {
          const parts = line.split(" ")
          currentFile = parts[parts.length - 1]
          conflictLines = []
        } else if (line.startsWith("removed in one")) {
          const parts = line.split(" ")
          currentFile = parts[parts.length - 1]
          conflictLines = []
        } else if (line.startsWith("modified in both")) {
          const match = line.match(/modified in both:\s+(.+)$/)
          if (match) {
            currentFile = match[1]
            conflictLines = []
          }
        } else if (currentFile && (line.includes("<<<<<<<") || line.includes(">>>>>>>") || line.includes("======="))) {
          conflictLines.push(`line ${i}`)
        }
      }

      if (currentFile && conflictLines.length > 0) {
        conflicts.push({
          path: currentFile,
          lines: conflictLines.slice(0, 5),
        })
      }
    }

    await $`git branch -D ${prBranch}`.nothrow().quiet()
  } catch (error) {
    console.error(`Error analyzing PR #${pr.number}:`, error)
  }

  return conflicts
}

async function main() {
  console.log("Fetching open PRs...\n")

  const prs = await fetchPRs()

  if (prs.length === 0) {
    console.log("No open PRs found.")
    process.exit(0)
  }

  console.log(`Found ${prs.length} open PRs\n`)

  const updated: PR[] = []
  const conflicted: { pr: PR; conflicts: ConflictInfo[] }[] = []

  for (const pr of prs) {
    if (pr.mergeable === "MERGEABLE") {
      const success = await updateBranch(pr.number)
      if (success) {
        updated.push(pr)
        console.log(`✅ Updated PR #${pr.number}: ${pr.title}`)
      } else {
        console.log(`⚠️ Failed to update PR #${pr.number}: ${pr.title}`)
      }
    } else if (pr.mergeable === "CONFLICTING") {
      console.log(`Analyzing conflicts for PR #${pr.number}...`)
      const conflicts = await getConflictDetails(pr)
      conflicted.push({ pr, conflicts })
    }
  }

  console.log("\n" + "=".repeat(50) + "\n")

  if (updated.length > 0) {
    console.log(`✅ Successfully updated ${updated.length} PR(s):`)
    for (const pr of updated) {
      console.log(`   #${pr.number}: ${pr.title}`)
    }
    console.log()
  }

  if (conflicted.length > 0) {
    console.log(`❌ ${conflicted.length} PR(s) have conflicts:\n`)
    for (const { pr, conflicts } of conflicted) {
      console.log(`PR #${pr.number}: ${pr.title}`)
      if (conflicts.length === 0) {
        console.log(`   (conflict details unavailable - manual check required)`)
      } else {
        for (const conflict of conflicts) {
          console.log(`   ${conflict.path}`)
        }
      }
      console.log()
    }
  }

  const unchanged = prs.length - updated.length - conflicted.length
  if (unchanged > 0) {
    console.log(`ℹ️ ${unchanged} PR(s) unchanged (unknown merge status)`)
  }

  console.log("\n" + "=".repeat(50))
  console.log(`\nSummary: ${updated.length} updated, ${conflicted.length} with conflicts`)
}

main().catch((error) => {
  console.error("Error:", error)
  process.exit(1)
})
