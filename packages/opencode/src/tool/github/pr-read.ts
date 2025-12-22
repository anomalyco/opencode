import z from "zod"
import { Tool } from "../tool"
import { GitHub } from "./github"

export const GithubPrReadTool = Tool.define("github_pr_read", {
  description:
    "Read details of a GitHub pull request including title, body, diff, commits, comments, and review comments",
  parameters: z.object({
    pull_number: z.number().describe("The pull request number to read"),
    include_diff: z.boolean().optional().describe("Whether to include the full diff (default: true)"),
  }),
  async execute(args) {
    const gql = await GitHub.getGraphQL()
    const octo = await GitHub.getClient()
    const { owner, repo } = await GitHub.getRepoInfo()

    const result = await gql<{
      repository: {
        pullRequest: {
          title: string
          body: string
          state: string
          author: { login: string }
          createdAt: string
          baseRefName: string
          headRefName: string
          headRefOid: string
          additions: number
          deletions: number
          commits: {
            totalCount: number
            nodes: Array<{
              commit: {
                oid: string
                message: string
                author: { name: string; email: string }
              }
            }>
          }
          files: {
            nodes: Array<{
              path: string
              additions: number
              deletions: number
              changeType: string
            }>
          }
          comments: {
            nodes: Array<{
              author: { login: string }
              body: string
              createdAt: string
            }>
          }
          reviews: {
            nodes: Array<{
              author: { login: string }
              body: string
              state: string
              submittedAt: string
              comments: {
                nodes: Array<{
                  path: string
                  line: number | null
                  body: string
                  author: { login: string }
                }>
              }
            }>
          }
        }
      }
    }>(
      `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      title
      body
      state
      author { login }
      createdAt
      baseRefName
      headRefName
      headRefOid
      additions
      deletions
      commits(first: 100) {
        totalCount
        nodes {
          commit {
            oid
            message
            author { name email }
          }
        }
      }
      files(first: 100) {
        nodes {
          path
          additions
          deletions
          changeType
        }
      }
      comments(first: 100) {
        nodes {
          author { login }
          body
          createdAt
        }
      }
      reviews(first: 100) {
        nodes {
          author { login }
          body
          state
          submittedAt
          comments(first: 100) {
            nodes {
              path
              line
              body
              author { login }
            }
          }
        }
      }
    }
  }
}`,
      { owner, repo, number: args.pull_number },
    )

    const pr = result.repository.pullRequest
    if (!pr) {
      return {
        title: `PR #${args.pull_number} not found`,
        output: `Pull request #${args.pull_number} was not found in ${owner}/${repo}`,
        metadata: {},
      }
    }

    const files = pr.files.nodes.map((f) => `- ${f.path} (${f.changeType}) +${f.additions}/-${f.deletions}`)

    const commits = pr.commits.nodes.map((c) => `- ${c.commit.oid.slice(0, 7)}: ${c.commit.message.split("\n")[0]}`)

    const comments = pr.comments.nodes.map((c) => `- ${c.author.login} (${c.createdAt}):\n  ${c.body}`)

    const reviews = pr.reviews.nodes.flatMap((r) => {
      const lines = [`- ${r.author.login} (${r.state}, ${r.submittedAt}):`]
      if (r.body) lines.push(`  ${r.body}`)
      for (const c of r.comments.nodes) {
        lines.push(`  - ${c.path}:${c.line ?? "?"}: ${c.body}`)
      }
      return lines
    })

    const sections = [
      `# PR #${args.pull_number}: ${pr.title}`,
      "",
      `**State:** ${pr.state}`,
      `**Author:** ${pr.author.login}`,
      `**Created:** ${pr.createdAt}`,
      `**Base:** ${pr.baseRefName} ← **Head:** ${pr.headRefName}`,
      `**Head Commit SHA:** ${pr.headRefOid}`,
      `**Changes:** +${pr.additions}/-${pr.deletions}`,
      "",
      "## Description",
      pr.body || "(No description)",
      "",
      "## Changed Files",
      ...files,
      "",
      "## Commits",
      ...commits,
    ]

    if (comments.length > 0) {
      sections.push("", "## Comments", ...comments)
    }

    if (reviews.length > 0) {
      sections.push("", "## Reviews", ...reviews)
    }

    // Include diff if requested (default: true)
    if (args.include_diff !== false) {
      try {
        const diff = await octo.rest.pulls.get({
          owner,
          repo,
          pull_number: args.pull_number,
          mediaType: { format: "diff" },
        })
        sections.push("", "## Diff", "```diff", diff.data as unknown as string, "```")
      } catch {
        sections.push("", "## Diff", "(Failed to fetch diff)")
      }
    }

    return {
      title: `PR #${args.pull_number}`,
      output: sections.join("\n"),
      metadata: {},
    }
  },
})
