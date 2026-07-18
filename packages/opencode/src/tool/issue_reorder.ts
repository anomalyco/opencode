import { Effect, Schema } from "effect"
import { Tool } from "./tool"
import DESCRIPTION from "./issue_reorder.txt"
import { Issue } from "../issue/issue"
import { context } from "@/project/instance-context"

const Parameters = Schema.Struct({
  ids: Schema.Array(Schema.String).annotate({
    description: "Issue ids in the desired order (array index becomes the new position)",
  }),
})

type Metadata = {
  count: number
}

/** Reorder workspace-scoped issues by providing the full id list in the new order */
export const IssueReorderTool = Tool.define(
  "issue_reorder",
  Effect.gen(function* () {
    const issue = yield* Issue.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const directory = context.use().directory
          yield* issue.reorder({ directory, ids: [...params.ids] })

          return {
            title: `issue_reorder: ${params.ids.length} issues`,
            output: JSON.stringify({ reordered: true, count: params.ids.length }, null, 2),
            metadata: { count: params.ids.length } satisfies Metadata,
          }
        }),
    }
  }),
)
