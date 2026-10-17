import { Plugin } from "@opencode/plugin"

const TEAM = {
  tui: ["kommander", "simonklee"],
  desktop_web: ["Hona", "Brendonovich"],
  core: ["jlongster", "rekram1-node", "neriousy", "nexxeln", "kitlangton"],
  inference: ["fwang", "MrMushrooooom", "starptech"],
  windows: ["Hona"],
} as const

function pick<T>(items: readonly T[]) {
  return items[Math.floor(Math.random() * items.length)]!
}

function getIssueNumber(): number {
  const issue = parseInt(process.env.ISSUE_NUMBER ?? "", 10)
  if (!issue) throw new Error("ISSUE_NUMBER env var not set")
  return issue
}

async function githubFetch(endpoint: string, options: RequestInit = {}) {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(options.headers instanceof Headers ? Object.fromEntries(options.headers.entries()) : options.headers),
    },
  })
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
  }
  return response.json()
}

export default Plugin.define({
  id: "github-triage",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "github-triage",
        description: `Use this tool to assign a GitHub issue.

Provide the team that should own the issue. This tool picks a random assignee from that team and does not apply labels.`,
        input: {
          type: "object",
          properties: {
            team: { type: "string", enum: Object.keys(TEAM), description: "The owning team" },
          },
          required: ["team"],
          additionalProperties: false,
        },
        // The triage agent denies every other tool, including Code Mode's `execute`.
        options: { codemode: false },
        async execute(input, context) {
          const team = (input as { team: keyof typeof TEAM }).team
          const issue = getIssueNumber()
          const owner = "anomalyco"
          const repo = "opencode"
          const assignee = pick(TEAM[team])

          await githubFetch(`/repos/${owner}/${repo}/issues/${issue}/assignees`, {
            method: "POST",
            body: JSON.stringify({ assignees: [assignee] }),
            signal: context.signal,
          })

          return { content: `Assigned @${assignee} from ${team} to issue #${issue}` }
        },
      })
    })
  },
})
