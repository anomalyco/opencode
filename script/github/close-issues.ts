#!/usr/bin/env bun

import { parseArgs } from "util"

const repo = "anomalyco/opencode"
const days = 60
const eligibleLabels = new Set(["triaging", "needs info"])
const msg = `Closing this issue because it has been waiting for more information with no activity for ${days} days. If this still happens and you can share the requested details, please open a new issue.`

const teamAssociations = new Set(["OWNER", "MEMBER"])

export type Issue = {
  number: number
  state?: string
  updated_at: string
  author_association: string
  user: { login: string; type?: string } | null
  labels?: Array<{ name?: string } | string>
  pull_request?: unknown
}

export type Comment = {
  user: { login: string; type?: string } | null
  author_association?: string
}

export type TimelineEvent = {
  event?: string
  source?: {
    issue?: {
      state?: string
      pull_request?: unknown
    }
  }
}

export function labelNames(issue: Issue) {
  return (issue.labels ?? [])
    .map((label) => (typeof label === "string" ? label : (label.name ?? "")).toLowerCase())
    .filter(Boolean)
}

export function isTeamActor(
  user: { login: string } | null | undefined,
  association: string | undefined,
  teamMembers: ReadonlySet<string>,
) {
  const login = user?.login.toLowerCase()
  return (login ? teamMembers.has(login) : false) || (association ? teamAssociations.has(association) : false)
}

export function shouldCloseIssue(
  issue: Issue,
  cutoff: Date,
  teamMembers: ReadonlySet<string>,
  details?: { comments: ReadonlyArray<Comment>; timeline: ReadonlyArray<TimelineEvent> },
) {
  if (issue.pull_request !== undefined) return false
  if (issue.state !== undefined && issue.state !== "open") return false
  if (new Date(issue.updated_at) >= cutoff) return false
  if (issue.user?.type === "Bot") return false
  if (isTeamActor(issue.user, issue.author_association, teamMembers)) return false
  if (!labelNames(issue).some((label) => eligibleLabels.has(label))) return false
  if (!details) return true
  // Never undo a reopen (by a maintainer or by the bot on an author reply).
  if (details.timeline.some((entry) => entry.event === "reopened")) return false
  // Never close when an open PR cross-references the issue.
  if (
    details.timeline.some(
      (entry) =>
        entry.event === "cross-referenced" &&
        entry.source?.issue?.pull_request !== undefined &&
        entry.source.issue.state === "open",
    )
  )
    return false
  // Never close if a team member engaged in the thread.
  if (details.comments.some((comment) => isTeamActor(comment.user, comment.author_association, teamMembers)))
    return false
  // Never close if the author was the last human to reply (the bot stalled, not the author).
  const authorLogin = issue.user?.login.toLowerCase()
  const lastHuman = [...details.comments].reverse().find((comment) => comment.user?.type !== "Bot")
  if (authorLogin && lastHuman?.user?.login.toLowerCase() === authorLogin) return false
  return true
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

  async function getJson<T>(url: string) {
    const res = await fetch(url, { headers })
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`)
    return (await res.json()) as T
  }

  async function close(num: number) {
    if (dryRun) {
      console.log(`[dry-run] Would close https://github.com/${repo}/issues/${num}`)
      return
    }
    const base = `https://api.github.com/repos/${repo}/issues/${num}`
    // Close first so a partial failure never leaves a "Closing this issue" comment on an open issue.
    const patch = await fetch(base, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ state: "closed", state_reason: "not_planned" }),
    })
    if (!patch.ok) throw new Error(`Failed to close #${num}: ${patch.status} ${patch.statusText}`)

    const comment = await fetch(`${base}/comments`, {
      method: "POST",
      headers,
      body: JSON.stringify({ body: msg }),
    })
    if (!comment.ok) {
      console.warn(`Closed #${num}, but failed to post comment: ${comment.status} ${comment.statusText}`)
      return
    }
    console.log(`Closed https://github.com/${repo}/issues/${num}`)
  }

  // Collect all candidate numbers first so closing items never shifts pagination.
  const candidateNumbers = new Set<number>()
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
      const all = await getJson<Issue[]>(`https://api.github.com/repos/${repo}/issues?${query}`)
      if (all.length === 0) break
      console.log(`Fetched label "${label}" page ${page}: ${all.length} items`)

      let hitFresh = false
      for (const issue of all) {
        if (new Date(issue.updated_at) >= cutoff) {
          hitFresh = true
          break
        }
        if (shouldCloseIssue(issue, cutoff, teamMembers)) candidateNumbers.add(issue.number)
      }
      if (hitFresh) break
      page++
    }
  }

  let closed = 0
  for (const num of candidateNumbers) {
    const base = `https://api.github.com/repos/${repo}/issues/${num}`
    const [live, comments, timeline] = await Promise.all([
      getJson<Issue>(base),
      getJson<Comment[]>(`${base}/comments?per_page=100`),
      getJson<TimelineEvent[]>(`${base}/timeline?per_page=100`),
    ])
    if (!shouldCloseIssue(live, cutoff, teamMembers, { comments, timeline })) {
      console.log(`Skipping #${num} after live thread check`)
      continue
    }
    await close(num)
    closed++
  }

  console.log(`${dryRun ? "[dry-run] Would close" : "Closed"} ${closed} issues total`)
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Error:", err)
    process.exit(1)
  })
}
