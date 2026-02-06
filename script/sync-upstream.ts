#!/usr/bin/env bun

import { $ } from "bun"
import path from "node:path"

const UPSTREAM_REPO = "anomalyco/opencode"
const UPSTREAM_BRANCH = "dev"
const DEV_BRANCH = "dev"
const PARENT_BRANCH = "parent-dev"
const REMOTE_UPSTREAM = "upstream"
const REMOTE_ORIGIN = "origin"
const SYNC_LABEL = "sync"
const CONFLICT_LABEL = "sync-conflict"
const SYNC_E2E_FAILURE_LABEL = "sync-e2e-failure"

function utcStamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
  ].join("")
}

function utcHuman(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:00 UTC`
}

function parseGitHubRepo(url: string): string | undefined {
  const match = url.trim().match(/(?:https:\/\/|git@)github\.com[/:]([^/\s]+\/[^/\s]+?)(?:\.git)?$/)
  return match?.[1]
}

async function resolveOriginRepo(): Promise<string> {
  const remote = (await $`git remote get-url ${REMOTE_ORIGIN}`.text()).trim()
  const repo = parseGitHubRepo(remote)
  if (!repo) {
    throw new Error(`Unable to resolve GitHub repo from origin URL: ${remote}`)
  }
  return repo
}

async function ensureLabel(repo: string, name: string, color: string, description: string): Promise<boolean> {
  const result =
    await $`gh label create ${name} --repo ${repo} --color ${color} --description ${description} --force`.nothrow()
  if (result.exitCode === 0) return true
  const stderr = result.stderr.toString().trim()
  console.warn(`Unable to ensure label "${name}" on ${repo}: ${stderr || "unknown error"}`)
  return false
}

function tailLog(text: string, limit = 12_000): string {
  if (text.length <= limit) return text
  return `...[truncated, showing last ${limit} chars]\n${text.slice(-limit)}`
}

function githubRunUrl(repo: string): string | undefined {
  const runId = process.env.GITHUB_RUN_ID
  const serverUrl = process.env.GITHUB_SERVER_URL ?? "https://github.com"
  if (!runId) return undefined
  return `${serverUrl}/${repo}/actions/runs/${runId}`
}

async function createIssueWithOptionalLabel(params: {
  repo: string
  title: string
  body: string
  label: string
}) {
  const hasLabel = await ensureLabel(
    params.repo,
    params.label,
    params.label === CONFLICT_LABEL ? "B60205" : "D93F0B",
    params.label === CONFLICT_LABEL ? "Upstream sync conflicts" : "Upstream sync e2e failures",
  )

  let issue = hasLabel
    ? await $`gh issue create --repo ${params.repo} --title ${params.title} --body ${params.body} --label ${params.label}`.nothrow()
    : await $`gh issue create --repo ${params.repo} --title ${params.title} --body ${params.body}`.nothrow()

  if (issue.exitCode !== 0 && hasLabel) {
    const stderr = issue.stderr.toString().trim()
    console.warn(`Failed to create labeled issue, retrying without label: ${stderr || "unknown error"}`)
    issue = await $`gh issue create --repo ${params.repo} --title ${params.title} --body ${params.body}`.nothrow()
  }

  if (issue.exitCode !== 0) {
    console.error("Failed to create issue:", issue.stderr.toString().trim())
    return false
  }
  return true
}

async function branchExists(branch: string): Promise<boolean> {
  const result = await $`git ls-remote --heads ${REMOTE_ORIGIN} ${branch}`.text()
  return result.trim().length > 0
}

async function ensureGhToken() {
  if (!process.env.GH_TOKEN && !process.env.UPSTREAM_SYNC_TOKEN) {
    throw new Error("Missing GH_TOKEN or UPSTREAM_SYNC_TOKEN for GitHub CLI auth.")
  }
}

async function ensureCleanTree() {
  const status = await $`git status --porcelain`.text()
  if (status.trim().length > 0) {
    throw new Error("Working tree is not clean. Aborting sync.")
  }
}

async function ensureUpstreamRemote() {
  const upstreamUrl = `https://github.com/${UPSTREAM_REPO}.git`
  const current = await $`git remote get-url ${REMOTE_UPSTREAM}`.nothrow()
  if (current.exitCode !== 0) {
    await $`git remote add ${REMOTE_UPSTREAM} ${upstreamUrl}`
    return
  }
  const existing = current.stdout.toString().trim()
  if (existing !== upstreamUrl) {
    await $`git remote set-url ${REMOTE_UPSTREAM} ${upstreamUrl}`
  }
}

async function handleConflict(params: {
  repo: string
  branch: string
  mergeBase: string
  behind: number
  ahead: number
}) {
  await $`git merge --abort`.nothrow()
  const title = `Upstream sync conflict (${utcHuman()})`
  const body = [
    "Automated upstream sync failed due to merge conflicts.",
    "",
    `Branch: ${params.branch}`,
    `Merge base: ${params.mergeBase}`,
    `Upstream commits behind: ${params.behind}`,
    `Fork commits ahead: ${params.ahead}`,
    "",
    "Next steps:",
    "- Checkout the branch and resolve conflicts.",
    "- Consult docs/upstream-sync.md for known conflict notes.",
    "- Push the fix and enable auto-merge once CI is green.",
  ].join("\n")

  const created = await createIssueWithOptionalLabel({
    repo: params.repo,
    title,
    body,
    label: CONFLICT_LABEL,
  })
  if (!created) {
    throw new Error("Merge conflicts detected. Failed to create conflict issue.")
  }

  throw new Error("Merge conflicts detected. Conflict issue created.")
}

async function runLinuxE2EGate(params: {
  repo: string
  branch: string
  mergeBase: string
  behind: number
  ahead: number
}) {
  console.log("Running linux e2e gate before opening sync PR...")
  const modelsPath = path.resolve("packages/opencode/test/tool/fixtures/models-api.json")

  const install = await $`bunx playwright install --with-deps`.cwd("packages/app").nothrow()
  if (install.exitCode !== 0) {
    const log = `${install.stdout.toString()}\n${install.stderr.toString()}`
    const title = `Upstream sync e2e setup failed (${utcHuman()})`
    const body = [
      "Automated upstream sync failed before PR creation.",
      "",
      `Branch: ${params.branch}`,
      `Merge base: ${params.mergeBase}`,
      `Upstream commits behind: ${params.behind}`,
      `Fork commits ahead: ${params.ahead}`,
      "",
      "Stage: Playwright install",
      "Command: `bunx playwright install --with-deps` (cwd: `packages/app`)",
      githubRunUrl(params.repo) ? `Run: ${githubRunUrl(params.repo)}` : "",
      "",
      "Log excerpt:",
      "```text",
      tailLog(log),
      "```",
    ]
      .filter(Boolean)
      .join("\n")

    await createIssueWithOptionalLabel({
      repo: params.repo,
      title,
      body,
      label: SYNC_E2E_FAILURE_LABEL,
    })
    throw new Error("Linux e2e gate failed during Playwright setup.")
  }

  const test = await $`bun run test:e2e:local -- --workers=2`
    .cwd("packages/app")
    .env({
      ...process.env,
      OPENCODE_DISABLE_MODELS_FETCH: "true",
      OPENCODE_MODELS_PATH: modelsPath,
    })
    .nothrow()
  if (test.exitCode === 0) {
    console.log("Linux e2e gate passed.")
    return
  }

  const log = `${test.stdout.toString()}\n${test.stderr.toString()}`
  const title = `Upstream sync e2e failed (${utcHuman()})`
  const body = [
    "Automated upstream sync failed before PR creation due to linux e2e test failures.",
    "",
    `Branch: ${params.branch}`,
    `Merge base: ${params.mergeBase}`,
    `Upstream commits behind: ${params.behind}`,
    `Fork commits ahead: ${params.ahead}`,
    "",
    "Stage: Linux e2e gate",
    "Command: `bun run test:e2e:local -- --workers=2` (cwd: `packages/app`)",
    githubRunUrl(params.repo) ? `Run: ${githubRunUrl(params.repo)}` : "",
    "",
    "Log excerpt:",
    "```text",
    tailLog(log),
    "```",
  ]
    .filter(Boolean)
    .join("\n")

  await createIssueWithOptionalLabel({
    repo: params.repo,
    title,
    body,
    label: SYNC_E2E_FAILURE_LABEL,
  })
  throw new Error("Linux e2e gate failed. Issue created.")
}

async function main() {
  await ensureGhToken()
  await ensureCleanTree()
  const repo = await resolveOriginRepo()

  await $`git config user.name "opencode-sync-bot"`
  await $`git config user.email "opencode-sync-bot@users.noreply.github.com"`

  await ensureUpstreamRemote()
  await $`git fetch ${REMOTE_UPSTREAM} --tags`
  await $`git fetch ${REMOTE_ORIGIN} ${DEV_BRANCH}`

  // Avoid ambiguous branch resolution once both origin/dev and upstream/dev exist.
  await $`git checkout -B ${DEV_BRANCH} ${REMOTE_ORIGIN}/${DEV_BRANCH}`

  await $`git branch -f ${PARENT_BRANCH} ${REMOTE_UPSTREAM}/${UPSTREAM_BRANCH}`
  await $`git push ${REMOTE_ORIGIN} ${PARENT_BRANCH} --force`

  const mergeBase = (await $`git merge-base ${PARENT_BRANCH} ${DEV_BRANCH}`.text()).trim()
  const counts = (await $`git rev-list --left-right --count ${PARENT_BRANCH}...${DEV_BRANCH}`.text())
    .trim()
    .split(/\s+/)
    .map((value) => Number(value))

  const behind = counts[0] ?? 0
  const ahead = counts[1] ?? 0

  if (behind === 0) {
    console.log("Upstream is already merged. Nothing to sync.")
    return
  }

  const baseBranch = `sync/upstream-dev-${utcStamp()}`
  let branch = baseBranch
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    if (!(await branchExists(branch))) break
    branch = `${baseBranch}-${attempt}`
  }

  await $`git checkout -b ${branch}`
  const mergeResult = await $`git merge --no-edit ${PARENT_BRANCH}`.nothrow()
  if (mergeResult.exitCode !== 0) {
    await handleConflict({ repo, branch, mergeBase, behind, ahead })
  }

  await runLinuxE2EGate({ repo, branch, mergeBase, behind, ahead })

  await $`git push ${REMOTE_ORIGIN} ${branch}`

  const hasSyncLabel = await ensureLabel(repo, SYNC_LABEL, "0366D6", "Automated upstream syncs")

  const title = `Sync upstream dev (${utcHuman()})`
  const body = [
    `Automated sync from ${UPSTREAM_REPO}:${UPSTREAM_BRANCH}.`,
    "",
    `Merge base: ${mergeBase}`,
    `Upstream commits behind: ${behind}`,
    `Fork commits ahead: ${ahead}`,
    "",
    "Generated by script/sync-upstream.ts.",
  ].join("\n")

  let pr = hasSyncLabel
    ? await $`gh pr create --repo ${repo} --base ${DEV_BRANCH} --head ${branch} --title ${title} --body ${body} --label ${SYNC_LABEL}`.nothrow()
    : await $`gh pr create --repo ${repo} --base ${DEV_BRANCH} --head ${branch} --title ${title} --body ${body}`.nothrow()

  if (pr.exitCode !== 0 && hasSyncLabel) {
    const stderr = pr.stderr.toString().trim()
    console.warn(`Failed to create labeled sync PR, retrying without label: ${stderr || "unknown error"}`)
    pr = await $`gh pr create --repo ${repo} --base ${DEV_BRANCH} --head ${branch} --title ${title} --body ${body}`.nothrow()
  }

  if (pr.exitCode !== 0) {
    console.error("Failed to create PR:", pr.stderr.toString())
    process.exit(1)
  }

  const prUrl = pr.stdout.toString().trim()
  const merge = await $`gh pr merge --repo ${repo} --auto --merge ${prUrl}`.nothrow()
  if (merge.exitCode !== 0) {
    console.error("Failed to enable auto-merge:", merge.stderr.toString())
    process.exit(1)
  }

  console.log(`✅ Sync PR created and auto-merge enabled: ${prUrl}`)
}

main().catch((err) => {
  console.error("❌ Sync failed:", err.message)
  process.exit(1)
})
