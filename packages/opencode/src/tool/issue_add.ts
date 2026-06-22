import z from "zod"
import { Effect } from "effect"
import { Tool } from "./tool"
import DESCRIPTION from "./issue_add.txt"
import { Issue } from "../issue/issue"
import { Instance } from "../project/instance"

const parameters = z.object({
  title: z.string().describe("Short label; falls back to content if empty"),
  content: z.string().optional().describe("Brief description shown in list rows; defaults to title"),
  description: z.string().optional().describe("Rich-text markdown body (file/skill references are added in the composer)"),
  status: Issue.Status.optional().describe("Status: backlog, todo, in_progress, in_review, done, canceled"),
  priority: Issue.Priority.optional().describe("Priority: none, urgent, high, medium, low"),
  parent_id: z
    .string()
    .nullable()
    .optional()
    .describe("Parent issue ID for L1→L2 hierarchy; null/omit for L1 root items"),
  level: z.number().int().min(0).max(1).optional().describe("Hierarchy depth: 0=L1, 1=L2"),
  due_date: z.string().nullable().optional().describe("Due date in ISO 8601 format"),
  assignee_id: z.string().nullable().optional().describe("Assignee user ID"),
  labels: z.array(z.string()).optional().describe("Tags for categorization"),
})

type Metadata = {
  issue: Issue.Info
}

/** Create a single workspace-scoped issue (todo) and return it */
export const IssueAddTool = Tool.define<typeof parameters, Metadata, Issue.Service>(
  "issue_add",
  Effect.gen(function* () {
    const issue = yield* Issue.Service

    return {
      description: DESCRIPTION,
      parameters,
      execute: (params: z.infer<typeof parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const directory = Instance.directory
          const created = yield* issue.create({
            directory,
            issue: {
              title: params.title,
              content: params.content ?? params.title,
              description: params.description ?? "",
              status: params.status ?? "todo",
              priority: params.priority ?? "none",
              parent_id: params.parent_id ?? null,
              level: params.level ?? (params.parent_id ? 1 : 0),
              due_date: params.due_date ?? null,
              assignee_id: params.assignee_id ?? null,
              labels: params.labels ?? [],
            },
          })

          return {
            title: `issue_add: ${created.title}`,
            output: JSON.stringify(created, null, 2),
            metadata: { issue: created },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof parameters, Metadata>
  }),
)
