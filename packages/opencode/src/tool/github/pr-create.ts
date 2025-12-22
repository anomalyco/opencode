import z from "zod"
import { Tool } from "../tool"
import { GitHub } from "./github"

export const GithubPrCreateTool = Tool.define("github_pr_create", {
  description: "Create a new pull request on GitHub",
  parameters: z.object({
    title: z.string().describe("Title of the pull request"),
    body: z.string().describe("Description/body of the pull request"),
    head: z.string().describe("The name of the branch where your changes are implemented"),
    base: z.string().describe("The name of the branch you want the changes pulled into"),
    draft: z.boolean().optional().describe("Whether to create the pull request as a draft"),
  }),
  async execute(args) {
    const octo = await GitHub.getClient()
    const { owner, repo } = await GitHub.getRepoInfo()

    const pr = await octo.rest.pulls.create({
      owner,
      repo,
      title: args.title,
      body: args.body,
      head: args.head,
      base: args.base,
      draft: args.draft,
    })

    return {
      title: `Created PR #${pr.data.number}`,
      output: `Successfully created pull request #${pr.data.number}: ${pr.data.html_url}`,
      metadata: {
        number: pr.data.number,
        url: pr.data.html_url,
      },
    }
  },
})
