import { Octokit } from "@octokit/rest"
import { tool } from "@opencode-ai/plugin"
import DESCRIPTION from "./github-triage.txt"

function getIssueNumber(): number {
  const issue = parseInt(process.env.ISSUE_NUMBER ?? "", 10)
  if (!issue) throw new Error("ISSUE_NUMBER env var not set")
  return issue
}

export default tool({
  description: DESCRIPTION,
  args: {
    assignee: tool.schema
      .enum(["thdxr", "adamdotdevin", "rekram1-node", "fwang", "jayair", "kommander"])
      .describe("The username of the assignee")
      .default("rekram1-node"),
    labels: tool.schema
      .array(tool.schema.enum(["nix", "opentui", "perf", "web", "zen", "docs"]))
      .describe("The labels(s) to add to the issue")
      .optional(),
  },
  async execute(args) {
    const issue = getIssueNumber()
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })
    const owner = "sst"
    const repo = "opencode"

    const results: string[] = []

    await octokit.rest.issues.addAssignees({
      owner,
      repo,
      issue_number: issue,
      assignees: [args.assignee],
    })
    results.push(`Assigned @${args.assignee} to issue #${issue}`)

    if (args.labels && args.labels.length > 0) {
      await octokit.rest.issues.addLabels({
        owner,
        repo,
        issue_number: issue,
        labels: args.labels,
      })
      results.push(`Added labels: ${args.labels.join(", ")}`)
    }

    return results.join("\n")
  },
})
