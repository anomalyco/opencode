/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import DESCRIPTION from "./github-triage.txt"

const TEAM = {
  desktop: ["adamdotdevin", "iamdavidhill", "Brendonovich", "nexxeln"],
  zen: ["fwang", "MrMushrooooom"],
  tui: [
    "thdxr",
    "kommander",
    // "rekram1-node" (on vacation)
  ],
  core: [
    "thdxr",
    // "rekram1-node", (on vacation)
    "jlongster",
  ],
  docs: ["R44VC0RP"],
  windows: ["Hona"],
} as const

const ASSIGNEES = [...new Set(Object.values(TEAM).flat())]

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
      ...options.headers,
    },
  })
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
  }
  return response.json()
}

export default tool({
  description: DESCRIPTION,
  args: {
    assignee: tool.schema.enum(ASSIGNEES as [string, ...string[]]).describe("The username of the assignee"),
    labels: tool.schema
      .array(tool.schema.enum(["nix", "opentui", "perf", "web", "desktop", "zen", "docs", "windows", "core"]))
      .describe("The labels(s) to add to the issue")
      .default([]),
  },
  async execute(args) {
    const issue = getIssueNumber()
    const owner = "anomalyco"
    const repo = "opencode"

    const results: string[] = []
    let labels = [...new Set(args.labels.map((x) => (x === "desktop" ? "web" : x)))]
    const web = labels.includes("web")
    const text = `${process.env.ISSUE_TITLE ?? ""}\n${process.env.ISSUE_BODY ?? ""}`.toLowerCase()
    const zen = /\bzen\b/.test(text) || text.includes("opencode black")
    const nix = /\bnix(os)?\b/.test(text)

    if (labels.includes("nix") && !nix) {
      labels = labels.filter((x) => x !== "nix")
      results.push("Dropped label: nix (issue does not mention nix)")
    }

    // const assignee = nix ? "rekram1-node" : web ? pick(TEAM.desktop) : args.assignee
    const assignee = web ? pick(TEAM.desktop) : args.assignee

    if (labels.includes("zen") && !zen) {
      throw new Error("Only add the zen label when issue title/body contains 'zen'")
    }

    if (web && !nix && !(TEAM.desktop as readonly string[]).includes(assignee)) {
      throw new Error("Web issues must be assigned to adamdotdevin, iamdavidhill, Brendonovich, or nexxeln")
    }

    if ((TEAM.zen as readonly string[]).includes(assignee) && !labels.includes("zen")) {
      throw new Error("Only zen issues should be assigned to fwang or MrMushrooooom")
    }

    if (assignee === "Hona" && !labels.includes("windows")) {
      throw new Error("Only windows issues should be assigned to Hona")
    }

    if (assignee === "R44VC0RP" && !labels.includes("docs")) {
      throw new Error("Only docs issues should be assigned to R44VC0RP")
    }

    if (assignee === "kommander" && !labels.includes("opentui")) {
      throw new Error("Only opentui issues should be assigned to kommander")
    }

    await githubFetch(`/repos/${owner}/${repo}/issues/${issue}/assignees`, {
      method: "POST",
      body: JSON.stringify({ assignees: [assignee] }),
    })
    results.push(`Assigned @${assignee} to issue #${issue}`)

    if (labels.length > 0) {
      await githubFetch(`/repos/${owner}/${repo}/issues/${issue}/labels`, {
        method: "POST",
        body: JSON.stringify({ labels }),
      })
      results.push(`Added labels: ${labels.join(", ")}`)
    }

    return results.join("\n")
  },
})
