#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"

interface PR {
  number: number
  title: string
  author: { login: string }
}

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
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
    const result = await $`gh pr list --state open --author ${member} --json number,title,author --limit 100`.nothrow()
    if (result.exitCode !== 0) continue
    const memberPrs: PR[] = JSON.parse(result.stdout)
    allPrs.push(...memberPrs)
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
  const fetchDev = await $`git fetch origin dev`.nothrow()
  if (fetchDev.exitCode !== 0) {
    throw new Error(`Failed to fetch dev branch: ${fetchDev.stderr}`)
  }

  console.log("Checking out beta branch...")
  const checkoutBeta = await $`git checkout -B beta origin/dev`.nothrow()
  if (checkoutBeta.exitCode !== 0) {
    throw new Error(`Failed to checkout beta branch: ${checkoutBeta.stderr}`)
  }

  const applied: number[] = []
  const failed: FailedPR[] = []

  for (const pr of prs) {
    console.log(`\nProcessing PR #${pr.number}: ${pr.title}`)

    console.log("  Fetching PR head...")
    const fetch = await run(["git", "fetch", "origin", `pull/${pr.number}/head:pr/${pr.number}`])
    if (fetch.exitCode !== 0) {
      console.log(`  Failed to fetch: ${fetch.stderr}`)
      failed.push({ number: pr.number, title: pr.title, reason: "Fetch failed" })
      continue
    }

    console.log("  Merging...")
    const merge = await run(["git", "merge", "--no-commit", "--no-ff", `pr/${pr.number}`])
    if (merge.exitCode !== 0) {
      console.log("  Failed to merge (conflicts)")
      await $`git merge --abort`.nothrow()
      await $`git checkout -- .`.nothrow()
      await $`git clean -fd`.nothrow()
      failed.push({ number: pr.number, title: pr.title, reason: "Merge conflicts" })
      continue
    }

    const mergeHead = await $`git rev-parse -q --verify MERGE_HEAD`.nothrow()
    if (mergeHead.exitCode !== 0) {
      console.log("  No changes, skipping")
      continue
    }

    const add = await $`git add -A`.nothrow()
    if (add.exitCode !== 0) {
      console.log("  Failed to stage changes")
      failed.push({ number: pr.number, title: pr.title, reason: "Staging failed" })
      continue
    }

    const commitMsg = `Apply PR #${pr.number}: ${pr.title}`
    const commit = await run(["git", "commit", "-m", commitMsg])
    if (commit.exitCode !== 0) {
      console.log(`  Failed to commit: ${commit.stderr}`)
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
  const push = await $`git push origin beta --force --no-verify`.nothrow()
  if (push.exitCode !== 0) {
    throw new Error(`Failed to push beta branch: ${push.stderr}`)
  }

  console.log("Successfully synced beta branch")
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})

async function run(args: string[], stdin?: Uint8Array): Promise<RunResult> {
  const proc = Bun.spawn(args, {
    stdin: stdin ?? "inherit",
    stdout: "pipe",
    stderr: "pipe",
  })
  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  return { exitCode, stdout, stderr }
}

function $(strings: TemplateStringsArray, ...values: unknown[]) {
  const cmd = strings.reduce((acc, str, i) => acc + str + (values[i] ?? ""), "")
  return {
    async nothrow() {
      const proc = Bun.spawn(cmd.split(" "), {
        stdout: "pipe",
        stderr: "pipe",
      })
      const exitCode = await proc.exited
      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      return { exitCode, stdout, stderr }
    },
  }
}
