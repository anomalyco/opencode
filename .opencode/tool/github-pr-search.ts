/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { type PR, buildSearchQuery, clampPaging, formatPr } from "../lib/github-pr-search.lib"

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
  description: `Use this tool to search GitHub pull requests by title and description.

This tool searches PRs in the anomalyco/opencode repository and returns LLM-friendly results. For each PR it returns:
- PR number and title
- Author
- State (open/closed/merged)
- Labels
- Description snippet
- URL

Pagination is page-based (1-indexed), matching the GitHub Search API exactly, so results never silently overlap or skip.`,
  args: {
    query: tool.schema.string().describe("Search query for PR titles and descriptions"),
    limit: tool.schema.number().describe("Results per page (max 100)").default(10),
    page: tool.schema.number().describe("1-indexed page number for pagination").default(1),
    state: tool.schema.enum(["open", "closed", "all"]).describe("Filter by PR state").default("open"),
  },
  async execute(args) {
    const owner = "anomalyco"
    const repo = "opencode"

    const { perPage, page } = clampPaging(args.limit, args.page)
    const searchQuery = encodeURIComponent(buildSearchQuery(args.query, owner, repo, args.state))
    const result = await githubFetch(
      `/search/issues?q=${searchQuery}&per_page=${perPage}&page=${page}&sort=updated&order=desc`,
    )

    if (result.total_count === 0) {
      return `No PRs found matching "${args.query}"`
    }

    const prs = result.items as PR[]

    if (prs.length === 0) {
      return `No PRs on page ${page} matching "${args.query}" (${result.total_count} total)`
    }

    const formatted = prs.map(formatPr).join("\n\n")

    return `Found ${result.total_count} PRs (page ${page}, showing ${prs.length}):\n\n${formatted}`
  },
})
