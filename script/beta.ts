#!/usr/bin/env bun

import { $ } from "bun"

interface PR {
  number: number
  title: string
  author: { login: string }
  labels: Array<{ name: string }>
}

interface FailedPR {
  number: number
  title: string
  reason: string
}

async function commentOnPR(prNumber: number, reason: string) {
  const body = `⚠️ **Blocking Beta Release**

This PR cannot be merged into the beta branch due to: **${reason}**

Please resolve this issue to include this PR in the next beta release.`

  try {
    await $`gh pr comment ${prNumber} --body ${body}`
    console.log(`  Posted comment on PR #${prNumber}`)
  } catch (err) {
    console.log(`  Failed to post comment on PR #${prNumber}: ${err}`)
  }
}

async function conflicts() {
  const out = await $`git diff --name-only --diff-filter=U`.text().catch(() => "")
  return out
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
}

async function cleanup() {
  try {
    await $`git merge --abort`
  } catch {}
  try {
    await $`git checkout -- .`
  } catch {}
  try {
    await $`git clean -fd`
  } catch {}
}

async function fix(pr: PR, files: string[]) {
  console.log(`  Trying to auto-resolve ${files.length} conflict(s) with opencode...`)
  const prompt = [
    `Resolve the current git merge conflicts while merging PR #${pr.number} into the beta branch.`,
    `Only touch these files: ${files.join(", ")}.`,
    "Keep the merge in progress, do not abort the merge, and do not create a commit.",
    "When done, leave the working tree with no unmerged files.",
  ].join("\n")

  try {
    await $`opencode run -m opencode/gpt-5.3-codex ${prompt}`
  } catch (err) {
    console.log(`  opencode failed: ${err}`)
    return false
  }

  const left = await conflicts()
  if (left.length > 0) {
    console.log(`  Conflicts remain: ${left.join(", ")}`)
    return false
  }

  console.log("  Conflicts resolved with opencode")
  return true
}

async function main() {
  console.log("Fetching open PRs with beta label...")

  const stdout = await $`gh pr list --state open --label beta --json number,title,author,labels --limit 100`.text()
  const prs: PR[] = JSON.parse(stdout).sort((a: PR, b: PR) => a.number - b.number)

  console.log(`Found ${prs.length} open PRs with beta label`)

  if (prs.length === 0) {
    console.log("No team PRs to merge")
    return
  }

  console.log("Fetching latest dev branch...")
  await $`git fetch origin dev`

  console.log("Checking out beta branch...")
  await $`git checkout -B beta origin/dev`

  const applied: number[] = []
  const failed: FailedPR[] = []

  for (const pr of prs) {
    console.log(`\nProcessing PR #${pr.number}: ${pr.title}`)

    console.log("  Fetching PR head...")
    try {
      await $`git fetch origin pull/${pr.number}/head:pr/${pr.number}`
    } catch (err) {
      console.log(`  Failed to fetch: ${err}`)
      failed.push({ number: pr.number, title: pr.title, reason: "Fetch failed" })
      await commentOnPR(pr.number, "Fetch failed")
      continue
    }

    console.log("  Merging...")
    try {
      await $`git merge --no-commit --no-ff pr/${pr.number}`
    } catch {
      const files = await conflicts()
      if (files.length > 0) {
        console.log("  Failed to merge (conflicts)")
        if (!(await fix(pr, files))) {
          await cleanup()
          failed.push({ number: pr.number, title: pr.title, reason: "Merge conflicts" })
          await commentOnPR(pr.number, "Merge conflicts with dev branch")
          continue
        }
      } else {
        console.log("  Failed to merge")
        await cleanup()
        failed.push({ number: pr.number, title: pr.title, reason: "Merge failed" })
        await commentOnPR(pr.number, "Merge failed")
        continue
      }
    }

    try {
      await $`git rev-parse -q --verify MERGE_HEAD`.text()
    } catch {
      console.log("  No changes, skipping")
      continue
    }

    try {
      await $`git add -A`
    } catch {
      console.log("  Failed to stage changes")
      failed.push({ number: pr.number, title: pr.title, reason: "Staging failed" })
      await commentOnPR(pr.number, "Failed to stage changes")
      continue
    }

    const commitMsg = `Apply PR #${pr.number}: ${pr.title}`
    try {
      await $`git commit -m ${commitMsg}`
    } catch (err) {
      console.log(`  Failed to commit: ${err}`)
      failed.push({ number: pr.number, title: pr.title, reason: "Commit failed" })
      await commentOnPR(pr.number, "Failed to commit changes")
      continue
    }

    console.log("  Applied successfully")
    applied.push(pr.number)
  }

  console.log("\n--- Summary ---")
  console.log(`Applied: ${applied.length} PRs`)
  applied.forEach((num) => console.log(`  - PR #${num}`))

  if (failed.length > 0) {
    console.log(`Failed: ${failed.length} PRs`)
    failed.forEach((f) => console.log(`  - PR #${f.number}: ${f.reason}`))
    throw new Error(`${failed.length} PR(s) failed to merge`)
  }

  console.log("\nChecking if beta branch has changes...")
  await $`git fetch origin beta`

  const localTree = await $`git rev-parse beta^{tree}`.text()
  const remoteTrees = (await $`git log origin/dev..origin/beta --format=%T`.text()).split("\n")

  const matchIdx = remoteTrees.indexOf(localTree.trim())
  if (matchIdx !== -1) {
    if (matchIdx !== 0) {
      console.log(`Beta branch contains this sync, but additional commits exist after it. Leaving beta branch as is.`)
    } else {
      console.log("Beta branch has identical contents, no push needed")
    }
    return
  }

  console.log("Force pushing beta branch...")
  await $`git push origin beta --force --no-verify`

  console.log("Successfully synced beta branch")
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})
