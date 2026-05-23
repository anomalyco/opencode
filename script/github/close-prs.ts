#!/usr/bin/env bun

import { parseArgs } from "util"

const defaultRepo = "anomalyco/opencode"
const defaultAgeMonths = 1
const defaultThreshold = 2
const defaultSleepMs = 20_000
const defaultPrintLimit = 50
const positiveReactions = new Set(["THUMBS_UP", "HEART", "HOORAY", "ROCKET"])
const cleanupLabel = "automated-pr-cleanup"

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    execute: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    repo: { type: "string", default: defaultRepo },
    threshold: { type: "string", default: String(defaultThreshold) },
    "age-months": { type: "string", default: String(defaultAgeMonths) },
    "max-close": { type: "string" },
    "sleep-ms": { type: "string", default: String(defaultSleepMs) },
    "print-limit": { type: "string", default: String(defaultPrintLimit) },
    help: { type: "boolean", short: "h", default: false },
  },
})

if (values.help) {
  console.log(`
Usage: bun script/github/close-prs.ts [options]

Dry-run is the default. The script only comments and closes PRs when --execute is passed.

Criteria:
  - PRs created within the last month are untouched
  - PRs older than one month are closed when they have fewer than 2 positive reactions
  - Positive reactions are THUMBS_UP, HEART, HOORAY, and ROCKET reactions on the PR

Options:
  --execute              Comment and close matching PRs
  --dry-run              Explicitly run without changing anything
  --repo <owner/repo>    Repository to clean up (default: ${defaultRepo})
  --threshold <n>        Positive reaction threshold (default: ${defaultThreshold})
  --age-months <n>       Age cutoff in months (default: ${defaultAgeMonths})
  --max-close <n>        Maximum matching PRs to process
  --sleep-ms <n>         Delay between closing PRs (default: ${defaultSleepMs})
  --print-limit <n>      Number of matching PRs to print in dry-run (default: ${defaultPrintLimit})
  -h, --help             Show this help message

Examples:
  bun script/github/close-prs.ts
  bun script/github/close-prs.ts --threshold 2 --print-limit 100
  bun script/github/close-prs.ts --execute --threshold 2 --max-close 25
`)
  process.exit(0)
}

if (values.execute && values["dry-run"]) {
  console.error("Use either --execute or --dry-run, not both")
  process.exit(1)
}

const token = await requireToken()
const repo = requireRepo(values.repo)
const threshold = requirePositiveInteger("threshold", values.threshold)
const ageMonths = requirePositiveInteger("age-months", values["age-months"])
const maxClose =
  values["max-close"] === undefined ? undefined : requirePositiveInteger("max-close", values["max-close"])
const sleepMs = requireNonNegativeInteger("sleep-ms", values["sleep-ms"])
const printLimit = requireNonNegativeInteger("print-limit", values["print-limit"])
const cutoff = subtractMonths(new Date(), ageMonths)

const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
}

type PullRequest = {
  number: number
  title: string
  url: string
  createdAt: string
  reactionGroups: Array<{
    content: string
    users: {
      totalCount: number
    }
  }>
  labels: {
    nodes: Array<{
      name: string
    }>
  }
}

type GraphqlResponse = {
  data?: {
    rateLimit: {
      cost: number
      remaining: number
      resetAt: string
    }
    repository: {
      pullRequests: {
        pageInfo: {
          hasNextPage: boolean
          endCursor: string | null
        }
        nodes: PullRequest[]
      }
    }
  }
  errors?: Array<{
    message: string
  }>
}

type CleanupCandidate = PullRequest & {
  positiveReactions: number
}

const message = `Automated PR Cleanup

Thank you for contributing to opencode.

Due to the high volume of PRs from users and AI agents, we periodically close older PRs using automated criteria so maintainers can focus review time on the most active and community-supported contributions.

This PR was closed because it matched the following cleanup criteria:

- The PR was created more than ${ageMonths === 1 ? "1 month" : `${ageMonths} months`} ago
- The PR had fewer than ${threshold} positive reactions
- Positive reactions are counted as thumbs-up, heart, celebration, or rocket reactions on the PR

PRs created within the last ${ageMonths === 1 ? "month are" : `${ageMonths} months are`} not affected by this cleanup.

If you believe this PR was closed incorrectly, or if you are still actively working on it, please leave a comment explaining why it should be reopened. A maintainer can review and reopen it if appropriate.

Thanks again for taking the time to contribute.`

async function main() {
  console.log(`${values.execute ? "EXECUTE" : "DRY RUN"}: PR cleanup for ${repo.owner}/${repo.name}`)
  console.log(`Cutoff: ${cutoff.toISOString()}`)
  console.log(`Threshold: fewer than ${threshold} positive reactions`)

  const prs = await fetchOpenPullRequests()
  const recentCount = prs.filter((pr) => new Date(pr.createdAt) >= cutoff).length
  const matching = prs
    .map((pr) => ({ ...pr, positiveReactions: positiveReactionCount(pr) }))
    .filter((pr) => new Date(pr.createdAt) < cutoff && pr.positiveReactions < threshold)
  const candidates = matching.filter((pr) => !hasPriorCleanup(pr))
  const selected = maxClose === undefined ? candidates : candidates.slice(0, maxClose)

  console.log(`Fetched ${prs.length} open PRs`)
  console.log(`Matching cleanup criteria: ${matching.length}`)
  console.log(`Skipped previously cleaned PRs: ${matching.length - candidates.length}`)
  console.log(`Recent PRs untouched: ${recentCount}`)
  console.log(
    `Older PRs with at least ${threshold} positive reactions untouched: ${prs.length - matching.length - recentCount}`,
  )

  if (selected.length === 0) return

  if (!values.execute) {
    console.log(`\nDry-run only. Re-run with --execute to comment and close matching PRs.`)
    console.log(`Showing ${Math.min(printLimit, selected.length)} of ${selected.length} matching PRs:\n`)
    for (const pr of selected.slice(0, printLimit)) {
      console.log(`#${pr.number} ${pr.createdAt} positive=${pr.positiveReactions} ${pr.url}`)
    }
    if (selected.length > printLimit) console.log(`... ${selected.length - printLimit} more not shown`)
    return
  }

  await ensureCleanupLabel()

  console.log(`\nCommenting and closing ${selected.length} PRs...`)
  for (const pr of selected) {
    await closePullRequest(pr)
    if (sleepMs > 0) await sleep(sleepMs)
  }
  console.log(`Closed ${selected.length} PRs`)
}

async function fetchOpenPullRequests() {
  const prs: PullRequest[] = []
  let endCursor: string | null = null

  while (true) {
    const page = await graphql({
      query: `query($owner: String!, $name: String!, $endCursor: String) {
        rateLimit {
          cost
          remaining
          resetAt
        }
        repository(owner: $owner, name: $name) {
          pullRequests(first: 100, states: OPEN, orderBy: { field: CREATED_AT, direction: ASC }, after: $endCursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              number
              title
              url
              createdAt
              reactionGroups {
                content
                users {
                  totalCount
                }
              }
              labels(first: 100) {
                nodes {
                  name
                }
              }
            }
          }
        }
      }`,
      variables: {
        owner: repo.owner,
        name: repo.name,
        endCursor,
      },
    })

    prs.push(...page.repository.pullRequests.nodes)
    console.log(
      `Fetched ${prs.length} PRs, GraphQL rate limit remaining ${page.rateLimit.remaining} (cost ${page.rateLimit.cost})`,
    )

    if (page.rateLimit.remaining < 100) {
      const delay = Math.max(0, new Date(page.rateLimit.resetAt).getTime() - Date.now()) + 1_000
      console.warn(`GraphQL rate limit low; sleeping ${Math.ceil(delay / 1000)}s until reset`)
      await sleep(delay)
    }

    if (!page.repository.pullRequests.pageInfo.hasNextPage) return prs
    endCursor = page.repository.pullRequests.pageInfo.endCursor
  }
}

async function graphql(input: { query: string; variables: Record<string, string | null> }) {
  const response = await githubRequest("/graphql", {
    method: "POST",
    body: JSON.stringify(input),
  })
  const body = (await response.json()) as GraphqlResponse
  if (body.errors?.length)
    throw new Error(`GitHub GraphQL error: ${body.errors.map((error) => error.message).join(", ")}`)
  if (!body.data) throw new Error("GitHub GraphQL response did not include data")
  return body.data
}

async function closePullRequest(pr: CleanupCandidate) {
  await githubRequest(`/repos/${repo.owner}/${repo.name}/issues/${pr.number}/comments`, {
    method: "POST",
    body: JSON.stringify({ body: message }),
  })
  await githubRequest(`/repos/${repo.owner}/${repo.name}/pulls/${pr.number}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "closed" }),
  })
  await githubRequest(`/repos/${repo.owner}/${repo.name}/issues/${pr.number}/labels`, {
    method: "POST",
    body: JSON.stringify({ labels: [cleanupLabel] }),
  })
  console.log(`Closed #${pr.number} positive=${pr.positiveReactions} ${pr.url}`)
}

async function ensureCleanupLabel() {
  const response = await fetch(
    `https://api.github.com/repos/${repo.owner}/${repo.name}/labels/${encodeURIComponent(cleanupLabel)}`,
    {
      headers,
    },
  )
  if (response.ok) return
  if (response.status !== 404)
    throw new Error(`Failed to check cleanup label: ${response.status} ${response.statusText}`)

  await githubRequest(`/repos/${repo.owner}/${repo.name}/labels`, {
    method: "POST",
    body: JSON.stringify({
      name: cleanupLabel,
      color: "ededed",
      description: "PR was closed by automated cleanup",
    }),
  })
}

async function githubRequest(path: string, init: RequestInit, attempt = 0): Promise<Response> {
  const response = await fetch(path.startsWith("https://") ? path : `https://api.github.com${path}`, {
    ...init,
    headers: {
      ...headers,
      ...init.headers,
    },
  })

  if (response.ok) return response

  const body = await response.text()
  const retryAfter = response.headers.get("retry-after")
  const reset = response.headers.get("x-ratelimit-reset")
  const retryMs = retryAfter
    ? Number(retryAfter) * 1000
    : response.headers.get("x-ratelimit-remaining") === "0" && reset
      ? Math.max(0, Number(reset) * 1000 - Date.now()) + 1_000
      : body.toLowerCase().includes("secondary rate limit")
        ? 300_000
        : response.status >= 500
          ? Math.min(300_000, 10_000 * 2 ** attempt)
          : 0

  if ((response.status === 403 || response.status === 429 || response.status >= 500) && retryMs > 0 && attempt < 10) {
    console.warn(`GitHub request failed; sleeping ${Math.ceil(retryMs / 1000)}s before retry ${attempt + 1}`)
    await sleep(retryMs)
    return githubRequest(path, init, attempt + 1)
  }

  throw new Error(`GitHub request failed: ${response.status} ${response.statusText}\n${body}`)
}

function positiveReactionCount(pr: PullRequest) {
  return pr.reactionGroups
    .filter((group) => positiveReactions.has(group.content))
    .reduce((total, group) => total + group.users.totalCount, 0)
}

function hasPriorCleanup(pr: PullRequest) {
  return pr.labels.nodes.some((label) => label.name === cleanupLabel)
}

function requireRepo(value: string | undefined) {
  if (!value) throw new Error("repo is required")
  const [owner, name] = value.split("/")
  if (!owner || !name) throw new Error(`Invalid repo ${value}; expected owner/name`)
  return { owner, name }
}

async function requireToken() {
  const envToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  if (envToken) return envToken

  const proc = Bun.spawn(["gh", "auth", "token"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  if (exitCode === 0 && stdout.trim()) return stdout.trim()

  throw new Error(
    `GitHub authentication is required. Set GITHUB_TOKEN/GH_TOKEN or run gh auth login.\n${stderr.trim()}`,
  )
}

function requirePositiveInteger(name: string, value: string | undefined) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}

function requireNonNegativeInteger(name: string, value: string | undefined) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`)
  return parsed
}

function subtractMonths(date: Date, months: number) {
  const result = new Date(date)
  const day = result.getUTCDate()
  result.setUTCDate(1)
  result.setUTCMonth(result.getUTCMonth() - months)
  result.setUTCDate(
    Math.min(day, new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()),
  )
  return result
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

void main().catch((error) => {
  console.error("Error:", error)
  process.exit(1)
})
