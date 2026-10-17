import { Plugin } from "@opencode/plugin"

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

interface PR {
  title: string
  html_url: string
}

export default Plugin.define({
  id: "github-pr-search",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "github-pr-search",
        description: `Use this tool to search GitHub pull requests by title and description.

This tool searches PRs in the anomalyco/opencode repository and returns LLM-friendly results including:
- PR number and title
- Author
- State (open/closed/merged)
- Labels
- Description snippet

Use the query parameter to search for keywords that might appear in PR titles or descriptions.`,
        input: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query for PR titles and descriptions" },
            limit: { type: "number", description: "Maximum number of results to return (default: 10)" },
            offset: { type: "number", description: "Number of results to skip for pagination (default: 0)" },
          },
          required: ["query"],
          additionalProperties: false,
        },
        // The duplicate-pr agent denies every other tool, including Code Mode's `execute`.
        options: { codemode: false },
        async execute(input, context) {
          const args = input as { query: string; limit?: number; offset?: number }
          const limit = args.limit ?? 10
          const offset = args.offset ?? 0
          const owner = "anomalyco"
          const repo = "opencode"

          const page = Math.floor(offset / limit) + 1
          const searchQuery = encodeURIComponent(`${args.query} repo:${owner}/${repo} type:pr state:open`)
          const result = await githubFetch(
            `/search/issues?q=${searchQuery}&per_page=${limit}&page=${page}&sort=updated&order=desc`,
            { signal: context.signal },
          )

          if (result.total_count === 0) {
            return { content: `No PRs found matching "${args.query}"` }
          }

          const prs = result.items as PR[]

          if (prs.length === 0) {
            return { content: `No other PRs found matching "${args.query}"` }
          }

          const formatted = prs.map((pr) => `${pr.title}\n${pr.html_url}`).join("\n\n")

          return { content: `Found ${result.total_count} PRs (showing ${prs.length}):\n\n${formatted}` }
        },
      })
    })
  },
})
