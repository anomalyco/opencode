/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { TEAM, type Team, pick, parseIssueNumber } from "../lib/github-triage.lib"

async function githubFetch(endpoint: string, options: RequestInit = {}) {
  const hasBody = options.body !== undefined && options.body !== null
  const response = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      // Only send Content-Type when there is actually a request body.
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(options.headers instanceof Headers ? Object.fromEntries(options.headers.entries()) : options.headers),
    },
  })
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
  }
  return response.json()
}

export default tool({
  description: `Use this tool to assign a GitHub issue.

Provide the team that should own the issue. This tool picks a random assignee from that team and does not apply labels.`,
  args: {
    team: tool.schema.enum(Object.keys(TEAM) as [Team, ...Team[]]).describe("The owning team"),
  },
  async execute(args) {
    const issue = parseIssueNumber(process.env.ISSUE_NUMBER)
    const owner = "anomalyco"
    const repo = "opencode"
    const assignee = pick(TEAM[args.team])

    await githubFetch(`/repos/${owner}/${repo}/issues/${issue}/assignees`, {
      method: "POST",
      body: JSON.stringify({ assignees: [assignee] }),
    })

    return `Assigned @${assignee} from ${args.team} to issue #${issue}`
  },
})
