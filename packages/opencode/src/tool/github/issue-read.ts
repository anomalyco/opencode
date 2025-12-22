import z from "zod"
import { Tool } from "../tool"
import { GitHub } from "./github"

export const GithubIssueReadTool = Tool.define("github_issue_read", {
  description: "Read details of a GitHub issue including title, body, labels, and comments",
  parameters: z.object({
    issue_number: z.number().describe("The issue number to read"),
  }),
  async execute(args) {
    const gql = await GitHub.getGraphQL()
    const { owner, repo } = await GitHub.getRepoInfo()

    const result = await gql<{
      repository: {
        issue: {
          title: string
          body: string
          state: string
          author: { login: string }
          createdAt: string
          labels: { nodes: Array<{ name: string }> }
          comments: {
            nodes: Array<{
              author: { login: string }
              body: string
              createdAt: string
            }>
          }
        }
      }
    }>(
      `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      title
      body
      state
      author { login }
      createdAt
      labels(first: 20) {
        nodes { name }
      }
      comments(first: 100) {
        nodes {
          author { login }
          body
          createdAt
        }
      }
    }
  }
}`,
      { owner, repo, number: args.issue_number },
    )

    const issue = result.repository.issue
    if (!issue) {
      return {
        title: `Issue #${args.issue_number} not found`,
        output: `Issue #${args.issue_number} was not found in ${owner}/${repo}`,
        metadata: {},
      }
    }

    const labels = issue.labels.nodes.map((l) => l.name).join(", ")
    const comments = issue.comments.nodes.map((c) => `- ${c.author.login} (${c.createdAt}):\n  ${c.body}`).join("\n\n")

    const output = [
      `# Issue #${args.issue_number}: ${issue.title}`,
      "",
      `**State:** ${issue.state}`,
      `**Author:** ${issue.author.login}`,
      `**Created:** ${issue.createdAt}`,
      labels ? `**Labels:** ${labels}` : "",
      "",
      "## Description",
      issue.body || "(No description)",
      "",
      issue.comments.nodes.length > 0 ? "## Comments" : "",
      comments,
    ]
      .filter(Boolean)
      .join("\n")

    return {
      title: `Issue #${args.issue_number}`,
      output,
      metadata: {},
    }
  },
})
