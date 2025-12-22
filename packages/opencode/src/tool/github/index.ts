export { GithubPrCommentTool } from "./pr-comment"
export { GithubPrCreateTool } from "./pr-create"
export { GithubPrReadTool } from "./pr-read"
export { GithubIssueReadTool } from "./issue-read"
export { GitHub } from "./github"

import type { Tool } from "../tool"
import { GithubPrCommentTool } from "./pr-comment"
import { GithubPrCreateTool } from "./pr-create"
import { GithubPrReadTool } from "./pr-read"
import { GithubIssueReadTool } from "./issue-read"

export const GithubTools: Tool.Info[] = [GithubPrCommentTool, GithubPrCreateTool, GithubPrReadTool, GithubIssueReadTool]
