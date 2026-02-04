import { $ } from "bun"

// Safety gate: verify remotes
async function verifyRemotes() {
  const origin = (await $`git remote get-url origin`.text()).trim()
  const upstream = (await $`git remote get-url upstream`.text()).trim()

  if (!origin.includes("GollyJer/open-ultrawork"))
    throw new Error(`origin must be GollyJer/open-ultrawork, got: ${origin}`)
  if (!upstream.includes("anomalyco/opencode")) throw new Error(`upstream must be anomalyco/opencode, got: ${upstream}`)
}

// Write output to GitHub Actions
async function output(key: string, value: string) {
  const path = process.env.GITHUB_OUTPUT
  if (!path) {
    console.log(`[output] ${key}=${value}`)
    return
  }
  await Bun.write(Bun.file(path), `${key}=${value}\n`, { append: true } as any)
}

async function main() {
  console.log("🔍 Verifying remotes...")
  await verifyRemotes()

  console.log("📥 Fetching upstream...")
  await $`git fetch upstream --tags`

  // Step 1: Mirror dev branch
  console.log("🔄 Mirroring dev branch...")
  await $`git checkout dev`
  await $`git reset --hard upstream/dev`
  await $`HUSKY=0 git push origin dev --force --no-verify`

  // Step 2: Check if ultrawork/dev needs update
  console.log("🔍 Checking for changes...")
  await $`git checkout ultrawork/dev`

  const devSha = (await $`git rev-parse dev`.text()).trim()
  const ultraworkSha = (await $`git rev-parse ultrawork/dev`.text()).trim()
  const upstreamSha = (await $`git rev-parse upstream/dev`.text()).trim()

  // Check if already synced (dev is ancestor of ultrawork/dev)
  const mergeBase = (await $`git merge-base dev ultrawork/dev`.text()).trim()
  if (mergeBase === devSha) {
    console.log("✅ Already up to date")
    await output("has_changes", "false")
    return
  }

  // Step 3: Create sync branch and attempt merge
  const date = new Date().toISOString().split("T")[0].replace(/-/g, "")
  const syncBranch = `sync/upstream-${date}`

  console.log(`📝 Creating sync branch: ${syncBranch}`)
  await $`git checkout -b ${syncBranch}`

  const mergeResult = await $`git merge dev --no-edit`.nothrow()
  const hasConflicts = mergeResult.exitCode !== 0

  if (hasConflicts) {
    console.log("⚠️ Conflicts detected, aborting merge")
    await $`git merge --abort`
    await $`git checkout ultrawork/dev`
    // Push empty sync branch for PR creation
    await $`git branch -D ${syncBranch}`
    await $`git checkout -b ${syncBranch}`
  } else {
    console.log("✅ Clean merge")
  }

  // Push sync branch
  await $`git push origin ${syncBranch} --no-verify`

  // Output results
  await output("has_changes", "true")
  await output("has_conflicts", hasConflicts.toString())
  await output("sync_branch", syncBranch)
  await output("upstream_sha", upstreamSha.slice(0, 7))
  await output("date", date)

  console.log(hasConflicts ? "⚠️ PR will need manual conflict resolution" : "✅ PR ready for auto-merge")
}

main().catch((err) => {
  console.error("❌ Sync failed:", err.message)
  process.exit(1)
})
