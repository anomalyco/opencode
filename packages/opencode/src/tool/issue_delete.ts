import z from "zod"
import { Effect } from "effect"
import { Tool } from "./tool"
import DESCRIPTION from "./issue_delete.txt"
import { Issue } from "../issue/issue"
import { Instance } from "../project/instance"

const parameters = z.object({
  id: z.string().describe("Unique identifier of the issue to delete"),
})

type Metadata = {
  deleted: boolean
  remainingCount: number
}

/** Delete a single workspace-scoped issue by id */
export const IssueDeleteTool = Tool.define<typeof parameters, Metadata, Issue.Service>(
  "issue_delete",
  Effect.gen(function* () {
    const issue = yield* Issue.Service

    return {
      description: DESCRIPTION,
      parameters,
      execute: (params: z.infer<typeof parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const directory = Instance.directory
          yield* issue.delete({ directory, id: params.id })
          const remaining = yield* issue.get({ directory })

          return {
            title: `issue_delete: ${params.id}`,
            output: JSON.stringify({ deleted: true, remainingCount: remaining.length }, null, 2),
            metadata: { deleted: true, remainingCount: remaining.length },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof parameters, Metadata>
  }),
)
