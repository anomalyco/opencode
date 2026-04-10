#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs/promises"

const model = "opencode/gpt-5.3-codex"

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

function lines(prs: PR[]) {
  return prs.map((x) => `- #${x.number}: ${x.title}`).join("\n") || "(none)"
}

async function typecheck() {
  console.log("  Running typecheck...")

  try {
    await $`bun typecheck`.cwd("packages/opencode")
    return true
  } catch (err) {
    console.log(`Typecheck failed: ${err}`)
    return false
  }
}

async function build() {
  console.log("  Running final build smoke check...")

  try {
    await $`./script/build.ts --single`.cwd("packages/opencode")
    return true
  } catch (err) {
    console.log(`Build failed: ${err}`)
    return false
  }
}

async function install() {
  console.log("  Regenerating bun.lock...")

  try {
    await fs.rm("bun.lock", { force: true })
    await $`bun install`
    await $`git add bun.lock`
    return true
  } catch (err) {
    console.log(`Install failed: ${err}`)
    return false
  }
}

async function fix(pr: PR, files: string[], prs: PR[], applied: number[], idx: number) {
  console.log(`  Trying to auto-resolve ${files.length} conflict(s) with opencode...`)

  const done = lines(prs.filter((x) => applied.includes(x.number)))
  const next = lines(prs.slice(idx + 1))

  const prompt = [
    `Resolve the current git merge conflicts while merging PR #${pr.number} into the beta branch.`,
    `PR #${pr.number}: ${pr.title}`,
    `Start with these conflicted files: ${files.join(", ")}.`,
    `Merged PRs on HEAD:\n${done}`,
    `Pending PRs after this one (context only):\n${next}`,
    "IMPORTANT: The conflict resolution must be consistent with already-merged PRs.",
    "Pending PRs are context only; do not introduce their changes unless they are already present on HEAD.",
    "Prefer already-merged PRs over the base branch when resolving stacked conflicts.",
    "If bun.lock is conflicted, do not hand-merge it. Delete bun.lock and run bun install after the code conflicts are resolved.",
    "If a PR already deleted a file/directory, do not re-add it, instead apply changes in the new semantic location.",
    "If a PR already changed an import, keep that change.",
    "After resolving the conflicts, run `bun typecheck` in `packages/opencode`.",
    "If typecheck fails, you may also update any files reported by typecheck.",
    "Keep any non-conflict edits narrowly scoped to restoring a valid merged state for the current PR batch.",
    "Fix any merge-caused typecheck errors before finishing.",
    "Keep the merge in progress, do not abort the merge, and do not create a commit.",
    "When done, leave the working tree with no unmerged files and a passing typecheck.",
  ].join("\n")

  try {
    await $`opencode run -m ${model} ${prompt}`
  } catch (err) {
    console.log(`  opencode failed: ${err}`)
    return false
  }

  const left = await conflicts()
  if (left.length > 0) {
    console.log(`  Conflicts remain: ${left.join(", ")}`)
    return false
  }

  if (files.includes("bun.lock") && !(await install())) return false

  if (!(await typecheck())) return false

  console.log("  Conflicts resolved with opencode")
  return true
}

async function smoke(prs: PR[], applied: number[]) {
  console.log("\nRunning final smoke check with opencode...")

  const done = lines(prs.filter((x) => applied.includes(x.number)))
  const prompt = [
    "The beta merge batch is complete.",
    `Merged PRs on HEAD:\n${done}`,
    "Run `bun typecheck` in `packages/opencode`.",
    "Run `./script/build.ts --single` in `packages/opencode`.",
    "Fix any merge-caused issues until both commands pass.",
    "Do not create a commit.",
  ].join("\n")

  try {
    await $`opencode run -m ${model} ${prompt}`
  } catch (err) {
    console.log(`Smoke fix failed: ${err}`)
    return false
  }

  if (!(await typecheck())) {
    return false
  }

  if (!(await build())) {
    return false
  }

  const out = await $`git status --porcelain`.text()
  if (!out.trim()) {
    console.log("Smoke check passed")
    return true
  }

  try {
    await $`git add -A`
    await $`git commit -m "Fix beta integration"`
  } catch (err) {
    console.log(`Failed to commit smoke fixes: ${err}`)
    return false
  }

  if (!(await typecheck())) {
    return false
  }

  if (!(await build())) {
    return false
  }

  console.log("Smoke check passed")
  return true
}

async function main() {
  console.log("Fetching open PRs with beta label...")

  const stdout =
    await $`gh pr list --state open --draft=false --label beta --json number,title,author,labels --limit 100`.text()
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

  for (const [idx, pr] of prs.entries()) {
    console.log(`\nProcessing PR ${idx + 1}/${prs.length} #${pr.number}: ${pr.title}`)

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
        if (!(await fix(pr, files, prs, applied, idx))) {
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

  if (applied.length > 0) {
    const ok = await smoke(prs, applied)
    if (!ok) {
      throw new Error("Final smoke check failed")
    }
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
