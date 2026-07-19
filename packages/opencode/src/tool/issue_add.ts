import { Effect, Schema } from "effect"
import { Tool } from "./tool"
import DESCRIPTION from "./issue_add.txt"
import { Issue } from "../issue/issue"
import { InstanceState } from "@/effect/instance-state"

const Parameters = Schema.Struct({
  title: Schema.String.annotate({ description: "Short label; falls back to content if empty" }),
  content: Schema.optional(Schema.String).annotate({
    description: "Brief description shown in list rows; defaults to title",
  }),
  description: Schema.optional(Schema.String).annotate({
    description: "Rich-text markdown body (file/skill references are added in the composer)",
  }),
  status: Schema.optional(Schema.String).annotate({
    description:
      "Linear workflow state name (e.g., 'Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Canceled', 'Duplicate'); defaults to 'Backlog' if omitted",
  }),
  priority: Schema.optional(Schema.Literals(["none", "urgent", "high", "medium", "low"])).annotate({
    description: "Priority: none, urgent, high, medium, low",
  }),
  parent_id: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description: "Parent issue ID for L1→L2 hierarchy; null/omit for L1 root items",
  }),
  level: Schema.optional(Schema.Int).annotate({ description: "Hierarchy depth: 0=L1, 1=L2" }),
  due_date: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description: "Due date in ISO 8601 format",
  }),
  assignee_id: Schema.optional(Schema.NullOr(Schema.String)).annotate({ description: "Assignee user ID" }),
  labels: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Tags for categorization" }),
})

type Metadata = {
  issue?: Issue.Info
}

/**
 * Discriminated union for the create outcome, mirroring the pattern in
 * `issue_delete.ts`. `Tool.define` requires the execute Effect to have
 * error channel `never`, so typed errors (`IssueHierarchyError`,
 * `IssueNotFoundError`) are caught via `Effect.catchTag` and folded into
 * this union, then converted to a tool output. Defects (Interrupt/Die)
 * propagate naturally.
 */
type CreateOutcome =
  | { ok: true; issue: Issue.Info }
  | { ok: false; reason: "hierarchy" | "not_found"; detail: string }

/** Create a single workspace-scoped issue (todo) and return it */
export const IssueAddTool = Tool.define(
  "issue_add",
  Effect.gen(function* () {
    const issue = yield* Issue.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const directory = yield* InstanceState.directory
          const outcome = yield* issue
            .create({
              directory,
              issue: {
                title: params.title,
                content: params.content ?? params.title,
                description: params.description ?? "",
                status: params.status ?? Issue.DEFAULT_STATUS,
                priority: params.priority ?? "none",
                parent_id: params.parent_id ?? null,
                level: params.level ?? (params.parent_id ? 1 : 0),
                due_date: params.due_date ?? null,
                assignee_id: params.assignee_id ?? null,
                labels: params.labels ? [...params.labels] : [],
              },
            })
            .pipe(
              Effect.map((created): CreateOutcome => ({ ok: true, issue: created })),
              Effect.catchTag("Issue.HierarchyError", (e) =>
                Effect.succeed<CreateOutcome>({
                  ok: false,
                  reason: "hierarchy",
                  detail: e.reason,
                }),
              ),
              Effect.catchTag("Issue.NotFoundError", (e) =>
                Effect.succeed<CreateOutcome>({
                  ok: false,
                  reason: "not_found",
                  detail: e.context ?? e.id,
                }),
              ),
            )

          if (!outcome.ok) {
            return {
              title: `issue_add: ${params.title} failed (${outcome.reason})`,
              output: JSON.stringify(
                { created: false, error: outcome.detail, reason: outcome.reason },
                null,
                2,
              ),
              metadata: {} as Metadata,
            }
          }

          return {
            title: `issue_add: ${outcome.issue.title}`,
            output: JSON.stringify(outcome.issue, null, 2),
            metadata: { issue: outcome.issue } satisfies Metadata,
          }
        }),
    }
  }),
)
