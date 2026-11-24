#!/usr/bin/env bun

import { parseArgs } from "util"

const repo = "anomalyco/opencode"
const days = 60
const eligibleLabels = new Set(["triaging", "needs info"])
const msg = `Closing this issue because it has been waiting for more information with no activity for ${days} days. If this still happens and you can share the requested details, please open a new issue.`

const agentLogins = new Set(["opencode-agent[bot]", "opencodejr[bot]"])
const teamAssociations = new Set(["OWNER", "MEMBER"])

export type Issue = {
  number: number
  updated_at: string
  author_association: string
  user: { login: string } | null
  labels?: Array<{ name?: string } | string>
  pull_request?: unknown
}

export function labelNames(issue: Issue) {
  return (issue.labels ?? [])
    .map((label) => (typeof label === "string" ? label : (label.name ?? "")).toLowerCase())
    .filter(Boolean)
}

export function shouldCloseIssue(issue: Issue, cutoff: Date, teamMembers: ReadonlySet<string>) {
  if (issue.pull_request !== undefined) return false
  if (new Date(issue.updated_at) >= cutoff) return false
  const login = issue.user?.login.toLowerCase()
  if (login && (agentLogins.has(login) || teamMembers.has(login))) return false
  if (teamAssociations.has(issue.author_association)) return false
  return labelNames(issue).some((label) => eligibleLabels.has(label))
}

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "dry-run": { type: "boolean", default: false },
    },
  })

  const token = process.env.GITHUB_TOKEN
  if (!token) {
    console.error("GITHUB_TOKEN environment variable is required")
    process.exit(1)
  }

  const dryRun = values["dry-run"]
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const teamMembers = new Set(
    (await Bun.file(new URL("../../.github/TEAM_MEMBERS", import.meta.url)).text())
      .split("\n")
      .map((line) => line.trim().toLowerCase())
      .filter(Boolean),
  )

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }

  async function close(num: number) {
    if (dryRun) {
      console.log(`[dry-run] Would close https://github.com/${repo}/issues/${num}`)
      return
    }
    const base = `https://api.github.com/repos/${repo}/issues/${num}`

    const comment = await fetch(`${base}/comments`, {
      method: "POST",
      headers,
      body: JSON.stringify({ body: msg }),
    })
    if (!comment.ok) throw new Error(`Failed to comment #${num}: ${comment.status} ${comment.statusText}`)

    const patch = await fetch(base, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ state: "closed", state_reason: "not_planned" }),
    })
    if (!patch.ok) throw new Error(`Failed to close #${num}: ${patch.status} ${patch.statusText}`)

    console.log(`Closed https://github.com/${repo}/issues/${num}`)
  }

  const closed = new Set<number>()

  for (const label of eligibleLabels) {
    let page = 1
    while (true) {
      const query = new URLSearchParams({
        state: "open",
        labels: label,
        sort: "updated",
        direction: "asc",
        per_page: "100",
        page: String(page),
      })
      const res = await fetch(`https://api.github.com/repos/${repo}/issues?${query}`, { headers })
      if (!res.ok) throw new Error(`Failed to list label "${label}" page ${page}: ${res.status} ${res.statusText}`)

      const all = (await res.json()) as Issue[]
      if (all.length === 0) break
      console.log(`Fetched label "${label}" page ${page}: ${all.length} items`)

      let hitFresh = false
      for (const issue of all) {
        if (new Date(issue.updated_at) >= cutoff) {
          console.log(`Found fresh issue #${issue.number} under "${label}", stopping label scan`)
          hitFresh = true
          break
        }
        if (closed.has(issue.number)) continue
        if (!shouldCloseIssue(issue, cutoff, teamMembers)) continue
        await close(issue.number)
        closed.add(issue.number)
      }

      if (hitFresh) break
      page++
    }
  }

  console.log(`${dryRun ? "[dry-run] Would close" : "Closed"} ${closed.size} issues total`)
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Error:", err)
    process.exit(1)
  })
}
