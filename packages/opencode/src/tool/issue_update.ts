import z from "zod"
import { Effect } from "effect"
import { Tool } from "./tool"
import DESCRIPTION from "./issue_update.txt"
import { Issue } from "../issue/issue"
import { Instance } from "../project/instance"

const parameters = z.object({
  id: z.string().describe("Unique identifier of the issue to update"),
  title: z.string().optional().describe("Short label"),
  content: z.string().optional().describe("Brief description shown in list rows"),
  description: z.string().optional().describe("Rich-text markdown body"),
  priority: Issue.Priority.optional().describe("Priority: none, urgent, high, medium, low"),
  due_date: z.string().nullable().optional().describe("Due date in ISO 8601 format"),
  assignee_id: z.string().nullable().optional().describe("Assignee user ID"),
  parent_id: z.string().nullable().optional().describe("Parent issue ID for L1/L2 hierarchy"),
  level: z.number().int().min(0).max(1).optional().describe("Hierarchy depth: 0=L1, 1=L2"),
  labels: z.array(z.string()).optional().describe("Tags for categorization"),
  position: z.number().int().optional().describe("Sort order within the same parent level"),
})

type Metadata = {
  issue: Issue.Info
}

/** Partially update a workspace-scoped issue by id */
export const IssueUpdateTool = Tool.define<typeof parameters, Metadata, Issue.Service>(
  "issue_update",
  Effect.gen(function* () {
    const issue = yield* Issue.Service

    return {
      description: DESCRIPTION,
      parameters,
      execute: (params: z.infer<typeof parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const directory = Instance.directory
          const patch: Partial<Issue.Info> = {}
          if (params.title !== undefined) patch.title = params.title
          if (params.content !== undefined) patch.content = params.content
          if (params.description !== undefined) patch.description = params.description
          if (params.priority !== undefined) patch.priority = params.priority
          if (params.due_date !== undefined) patch.due_date = params.due_date
          if (params.assignee_id !== undefined) patch.assignee_id = params.assignee_id
          if (params.parent_id !== undefined) patch.parent_id = params.parent_id
          if (params.level !== undefined) patch.level = params.level
          if (params.labels !== undefined) patch.labels = params.labels
          if (params.position !== undefined) patch.position = params.position

          const updated = yield* issue.update({ directory, id: params.id, patch })

          return {
            title: `issue_update: ${updated.title}`,
            output: JSON.stringify(updated, null, 2),
            metadata: { issue: updated },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof parameters, Metadata>
  }),
)
