#!/usr/bin/env bun

import { $ } from "bun"
import { Script } from "@opencode-ai/script"

interface PR {
  number: number
  title: string
  author: { login: string }
}

interface FailedPR {
  number: number
  title: string
  reason: string
}

async function postToDiscord(failures: FailedPR[]) {
  const webhookUrl = process.env.DISCORD_ISSUES_WEBHOOK_URL
  if (!webhookUrl) {
    console.log("Warning: DISCORD_ISSUES_WEBHOOK_URL not set, skipping Discord notification")
    return
  }

  const message = `**Beta Branch Merge Failures**

The following team PRs failed to merge into the beta branch:

${failures.map((f) => `- **#${f.number}**: ${f.title} - ${f.reason}`).join("\n")}

Please resolve these conflicts manually.`

  const content = JSON.stringify({ content: message })

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: content,
  })

  if (!response.ok) {
    console.error("Failed to post to Discord:", await response.text())
  } else {
    console.log("Posted failures to Discord")
  }
}

async function main() {
  console.log("Fetching open PRs from team members...")

  const allPrs: PR[] = []
  for (const member of Script.team) {
    try {
      const stdout = await $`gh pr list --state open --author ${member} --json number,title,author --limit 100`.text()
      const memberPrs: PR[] = JSON.parse(stdout)
      allPrs.push(...memberPrs)
    } catch {
      // Skip member on error
    }
  }

  const seen = new Set<number>()
  const prs = allPrs.filter((pr) => {
    if (seen.has(pr.number)) return false
    seen.add(pr.number)
    return true
  })

  console.log(`Found ${prs.length} open PRs from team members`)

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
      continue
    }

    console.log("  Merging...")
    try {
      await $`git merge --no-commit --no-ff pr/${pr.number}`
    } catch {
      console.log("  Failed to merge (conflicts)")
      try {
        await $`git merge --abort`
      } catch {}
      try {
        await $`git checkout -- .`
      } catch {}
      try {
        await $`git clean -fd`
      } catch {}
      failed.push({ number: pr.number, title: pr.title, reason: "Merge conflicts" })
      continue
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
      continue
    }

    const commitMsg = `Apply PR #${pr.number}: ${pr.title}`
    try {
      await $`git commit -m ${commitMsg}`
    } catch (err) {
      console.log(`  Failed to commit: ${err}`)
      failed.push({ number: pr.number, title: pr.title, reason: "Commit failed" })
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

    await postToDiscord(failed)

    throw new Error(`${failed.length} PR(s) failed to merge. Check Discord for details.`)
  }

  console.log("\nForce pushing beta branch...")
  await $`git push origin beta --force --no-verify`

  console.log("Successfully synced beta branch")
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})
