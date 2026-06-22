import z from "zod"
import { Effect } from "effect"
import { Tool } from "./tool"
import DESCRIPTION from "./issue_list.txt"
import { Issue } from "../issue/issue"
import { Instance } from "../project/instance"

const parameters = z.object({
  tree: z
    .boolean()
    .optional()
    .describe("When true, return the L1/L2 hierarchy as a tree with children nested under each parent"),
  status: Issue.Status.optional().describe("Optional filter: only return issues with this status"),
  priority: Issue.Priority.optional().describe("Optional filter: only return issues with this priority"),
})

type Metadata = {
  count: number
}

/** List workspace-scoped issues (todos) for the current project directory */
export const IssueListTool = Tool.define<typeof parameters, Metadata, Issue.Service>(
  "issue_list",
  Effect.gen(function* () {
    const issue = yield* Issue.Service

    return {
      description: DESCRIPTION,
      parameters,
      execute: (params: z.infer<typeof parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const directory = Instance.directory
          const issues = params.tree ? yield* issue.getTree({ directory }) : yield* issue.get({ directory })
          const filtered = issues.filter((i) => {
            if (params.status && i.status !== params.status) return false
            if (params.priority && i.priority !== params.priority) return false
            return true
          })

          return {
            title: `issue_list: ${filtered.length} issues`,
            output: JSON.stringify(filtered, null, 2),
            metadata: { count: filtered.length },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof parameters, Metadata>
  }),
)
