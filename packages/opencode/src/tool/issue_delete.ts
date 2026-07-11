import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./issue_delete.txt"
import { Issue } from "../issue/issue"
import { context } from "@/project/instance-context"

const Parameters = Schema.Struct({
  id: Schema.String.annotate({ description: "Unique identifier of the issue to delete" }),
})

type Metadata = {
  deleted: boolean
  remainingCount: number
}

/** Delete a single workspace-scoped issue by id */
export const IssueDeleteTool = Tool.define(
  "issue_delete",
  Effect.gen(function* () {
    const issue = yield* Issue.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const directory = context.use().directory
          yield* issue.delete({ directory, id: params.id })
          const remaining = yield* issue.get({ directory })

          return {
            title: `issue_delete: ${params.id}`,
            output: JSON.stringify({ deleted: true, remainingCount: remaining.length }, null, 2),
            metadata: { deleted: true, remainingCount: remaining.length } satisfies Metadata,
          }
        }),
    }
  }),
)
