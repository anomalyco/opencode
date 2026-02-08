/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import DESCRIPTION from "./github-pr-triage.txt"

function getPRNumber(): number {
  const pr = parseInt(process.env.PR_NUMBER ?? "", 10)
  if (!pr) throw new Error("PR_NUMBER env var not set")
  return pr
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
    labels: tool.schema
      .array(tool.schema.enum(["nix", "opentui", "perf", "web", "zen", "docs", "windows"]))
      .describe("The label(s) to add to the PR")
      .default([]),
  },
  async execute(args) {
    const pr = getPRNumber()
    const owner = "anomalyco"
    const repo = "opencode"

    const results: string[] = []

    const labels: string[] = args.labels

    if (labels.length > 0) {
      await githubFetch(`/repos/${owner}/${repo}/issues/${pr}/labels`, {
        method: "POST",
        body: JSON.stringify({ labels }),
      })
      results.push(`Added labels: ${args.labels.join(", ")}`)
    }

    return results.join("\n")
  },
})
