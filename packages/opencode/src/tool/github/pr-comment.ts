import z from "zod"
import { Tool } from "../tool"
import { GitHub } from "./github"

export const GithubPrCommentTool = Tool.define("github_pr_comment", {
  description: "Create a review comment on a specific line or line range in a pull request",
  parameters: z.object({
    pull_number: z.number().describe("Pull request number"),
    commit_id: z.string().describe("SHA of the commit to comment on"),
    path: z.string().describe("File path relative to repository root"),
    line: z.number().describe("Line number in the new version of the file (end line for multi-line comments)"),
    start_line: z
      .number()
      .optional()
      .describe("Starting line number for multi-line comments. If provided, comment spans from start_line to line"),
    body: z.string().describe("Comment text. Use ```suggestion blocks for code fixes"),
    side: z.enum(["LEFT", "RIGHT"]).optional().describe("LEFT for old version, RIGHT for new (default)"),
    start_side: z
      .enum(["LEFT", "RIGHT"])
      .optional()
      .describe("Side for start_line in multi-line comments. Defaults to RIGHT"),
  }),
  async execute(args) {
    const octo = await GitHub.getClient()
    const { owner, repo } = await GitHub.getRepoInfo()

    const lineRange = args.start_line ? `${args.start_line}-${args.line}` : `${args.line}`

    await octo.rest.pulls.createReviewComment({
      owner,
      repo,
      pull_number: args.pull_number,
      commit_id: args.commit_id,
      path: args.path,
      line: args.line,
      body: args.body,
      side: args.side ?? "RIGHT",
      ...(args.start_line
        ? {
            start_line: args.start_line,
            start_side: args.start_side ?? "RIGHT",
          }
        : {}),
    })

    return {
      title: `Comment on ${args.path}:${lineRange}`,
      output: `Successfully created review comment on ${args.path} at line${args.start_line ? "s" : ""} ${lineRange}`,
      metadata: {},
    }
  },
})
