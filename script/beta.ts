#!/usr/bin/env bun

interface PR {
  number: number
  title: string
}

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

async function main() {
  console.log("Fetching open contributor PRs...")

  const prsResult = await $`gh pr list --label contributor --state open --json number,title --limit 100`.nothrow()
  if (prsResult.exitCode !== 0) {
    throw new Error(`Failed to fetch PRs: ${prsResult.stderr}`)
  }

  const prs: PR[] = JSON.parse(prsResult.stdout)
  console.log(`Found ${prs.length} open contributor PRs`)

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
  const skipped: Array<{ number: number; reason: string }> = []

  for (const pr of prs) {
    console.log(`\nProcessing PR #${pr.number}: ${pr.title}`)

    console.log("  Fetching PR head...")
    const fetch = await run(["git", "fetch", "origin", `pull/${pr.number}/head:pr/${pr.number}`])
    if (fetch.exitCode !== 0) {
      console.log(`  Failed to fetch PR head: ${fetch.stderr}`)
      skipped.push({ number: pr.number, reason: `Fetch failed: ${fetch.stderr}` })
      continue
    }

    console.log("  Merging...")
    const merge = await run(["git", "merge", "--no-commit", "--no-ff", `pr/${pr.number}`])
    if (merge.exitCode !== 0) {
      console.log("  Failed to merge (conflicts)")
      await $`git merge --abort`.nothrow()
      await $`git checkout -- .`.nothrow()
      await $`git clean -fd`.nothrow()
      skipped.push({ number: pr.number, reason: "Has conflicts" })
      continue
    }

    const mergeHead = await $`git rev-parse -q --verify MERGE_HEAD`.nothrow()
    if (mergeHead.exitCode !== 0) {
      console.log("  No changes, skipping")
      skipped.push({ number: pr.number, reason: "No changes" })
      continue
    }

    const add = await $`git add -A`.nothrow()
    if (add.exitCode !== 0) {
      console.log("  Failed to stage")
      await $`git checkout -- .`.nothrow()
      await $`git clean -fd`.nothrow()
      skipped.push({ number: pr.number, reason: "Failed to stage" })
      continue
    }

    const commitMsg = `Apply PR #${pr.number}: ${pr.title}`
    const commit = await run(["git", "commit", "-m", commitMsg])
    if (commit.exitCode !== 0) {
      console.log(`  Failed to commit: ${commit.stderr}`)
      await $`git checkout -- .`.nothrow()
      await $`git clean -fd`.nothrow()
      skipped.push({ number: pr.number, reason: `Commit failed: ${commit.stderr}` })
      continue
    }

    console.log("  Applied successfully")
    applied.push(pr.number)
  }

  console.log("\n--- Summary ---")
  console.log(`Applied: ${applied.length} PRs`)
  applied.forEach((num) => console.log(`  - PR #${num}`))
  console.log(`Skipped: ${skipped.length} PRs`)
  skipped.forEach((x) => console.log(`  - PR #${x.number}: ${x.reason}`))

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
