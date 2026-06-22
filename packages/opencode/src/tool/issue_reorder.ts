import z from "zod"
import { Effect } from "effect"
import { Tool } from "./tool"
import DESCRIPTION from "./issue_reorder.txt"
import { Issue } from "../issue/issue"
import { Instance } from "../project/instance"

const parameters = z.object({
  ids: z.array(z.string()).describe("Issue ids in the desired order (array index becomes the new position)"),
})

type Metadata = {
  count: number
}

/** Reorder workspace-scoped issues by providing the full id list in the new order */
export const IssueReorderTool = Tool.define<typeof parameters, Metadata, Issue.Service>(
  "issue_reorder",
  Effect.gen(function* () {
    const issue = yield* Issue.Service

    return {
      description: DESCRIPTION,
      parameters,
      execute: (params: z.infer<typeof parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const directory = Instance.directory
          yield* issue.reorder({ directory, ids: params.ids })

          return {
            title: `issue_reorder: ${params.ids.length} issues`,
            output: JSON.stringify({ reordered: true, count: params.ids.length }, null, 2),
            metadata: { count: params.ids.length },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof parameters, Metadata>
  }),
)
