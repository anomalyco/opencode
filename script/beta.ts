#!/usr/bin/env bun

interface PR {
  number: number
  title: string
}

interface Repo {
  nameWithOwner: string
}

interface HeadRepo {
  nameWithOwner: string
}

interface PRHead {
  headRefName: string
  headRepository: HeadRepo
}

async function main() {
  console.log("Fetching open contributor PRs...")

  const prsResult = await $`gh pr list --label contributor --state open --json number,title --limit 100`.nothrow()
  if (prsResult.exitCode !== 0) {
    throw new Error(`Failed to fetch PRs: ${prsResult.stderr}`)
  }

  const prs: PR[] = JSON.parse(prsResult.stdout)
  console.log(`Found ${prs.length} open contributor PRs`)

  const repoResult = await $`gh repo view --json nameWithOwner`.nothrow()
  if (repoResult.exitCode !== 0) {
    throw new Error(`Failed to fetch repo info: ${repoResult.stderr}`)
  }
  const repo: Repo = JSON.parse(repoResult.stdout)

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

    const headResult = await $`gh pr view ${pr.number} --json headRefName,headRepository`.nothrow()
    if (headResult.exitCode !== 0) {
      console.log(`  Failed to get head info`)
      skipped.push({ number: pr.number, reason: `Failed to get head info: ${headResult.stderr}` })
      continue
    }
    const head: PRHead = JSON.parse(headResult.stdout)

    // Get the diff from GitHub compare API
    console.log(`  Getting diff...`)
    const compare = `${repo.nameWithOwner}/compare/dev...${head.headRepository.nameWithOwner}:${head.headRefName}`
    const diffResult = await $`gh api -H Accept:application/vnd.github.v3.diff repos/${compare}`.nothrow()
    if (diffResult.exitCode !== 0) {
      console.log(`  Failed to get diff: ${diffResult.stderr}`)
      console.log(`  Compare: ${compare}`)
      skipped.push({ number: pr.number, reason: `Failed to get diff: ${diffResult.stderr}` })
      continue
    }

    if (!diffResult.stdout.trim()) {
      console.log(`  No changes, skipping`)
      skipped.push({ number: pr.number, reason: "No changes" })
      continue
    }

    // Try to apply the diff
    console.log(`  Applying...`)
    const apply = await Bun.spawn(["git", "apply", "--3way"], {
      stdin: new TextEncoder().encode(diffResult.stdout),
      stdout: "pipe",
      stderr: "pipe",
    })
    const applyExit = await apply.exited
    const applyStderr = await Bun.readableStreamToText(apply.stderr)

    if (applyExit !== 0) {
      console.log(`  Failed to apply (conflicts)`)
      await $`git checkout -- .`.nothrow()
      await $`git clean -fd`.nothrow()
      skipped.push({ number: pr.number, reason: "Has conflicts" })
      continue
    }

    // Stage and commit
    const add = await $`git add -A`.nothrow()
    if (add.exitCode !== 0) {
      console.log(`  Failed to stage`)
      await $`git checkout -- .`.nothrow()
      await $`git clean -fd`.nothrow()
      skipped.push({ number: pr.number, reason: "Failed to stage" })
      continue
    }

    const commitMsg = `Apply PR #${pr.number}: ${pr.title}`
    const commit = await Bun.spawn(["git", "commit", "-m", commitMsg], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const commitExit = await commit.exited
    const commitStderr = await Bun.readableStreamToText(commit.stderr)
    if (commitExit !== 0) {
      console.log(`  Failed to commit: ${commitStderr}`)
      await $`git checkout -- .`.nothrow()
      await $`git clean -fd`.nothrow()
      skipped.push({ number: pr.number, reason: `Commit failed: ${commitStderr}` })
      continue
    }

    console.log(`  Applied successfully`)
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
