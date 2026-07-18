import { Effect, Schema } from "effect"
import { Tool } from "./tool"
import DESCRIPTION from "./issue_update.txt"
import { Issue } from "../issue/issue"
import { context } from "@/project/instance-context"

const Parameters = Schema.Struct({
  id: Schema.String.annotate({ description: "Unique identifier of the issue to update" }),
  title: Schema.optional(Schema.String).annotate({ description: "Short label" }),
  content: Schema.optional(Schema.String).annotate({ description: "Brief description shown in list rows" }),
  description: Schema.optional(Schema.String).annotate({ description: "Rich-text markdown body" }),
  priority: Schema.optional(Schema.Literals(["none", "urgent", "high", "medium", "low"])).annotate({
    description: "Priority: none, urgent, high, medium, low",
  }),
  due_date: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description: "Due date in ISO 8601 format",
  }),
  assignee_id: Schema.optional(Schema.NullOr(Schema.String)).annotate({ description: "Assignee user ID" }),
  parent_id: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description: "Parent issue ID for L1/L2 hierarchy",
  }),
  level: Schema.optional(Schema.Int).annotate({ description: "Hierarchy depth: 0=L1, 1=L2" }),
  labels: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Tags for categorization" }),
  position: Schema.optional(Schema.Int).annotate({ description: "Sort order within the same parent level" }),
})

type Metadata = {
  issue: Issue.Info
}

/** Partially update a workspace-scoped issue by id */
export const IssueUpdateTool = Tool.define(
  "issue_update",
  Effect.gen(function* () {
    const issue = yield* Issue.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const directory = context.use().directory
          const patch: Partial<Issue.Info> = {}
          if (params.title !== undefined) patch.title = params.title
          if (params.content !== undefined) patch.content = params.content
          if (params.description !== undefined) patch.description = params.description
          if (params.priority !== undefined) patch.priority = params.priority
          if (params.due_date !== undefined) patch.due_date = params.due_date
          if (params.assignee_id !== undefined) patch.assignee_id = params.assignee_id
          if (params.parent_id !== undefined) patch.parent_id = params.parent_id
          if (params.level !== undefined) patch.level = params.level
          if (params.labels !== undefined) patch.labels = [...params.labels]
          if (params.position !== undefined) patch.position = params.position

          const updated = yield* issue.update({ directory, id: params.id, patch })

          return {
            title: `issue_update: ${updated.title}`,
            output: JSON.stringify(updated, null, 2),
            metadata: { issue: updated } satisfies Metadata,
          }
        }),
    }
  }),
)
