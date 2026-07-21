import { Effect, Schema } from "effect"
import { Tool } from "./tool"
import DESCRIPTION from "./issue_update.txt"
import { Issue } from "../issue/issue"
import { InstanceState } from "@/effect/instance-state"

const Parameters = Schema.Struct({
  id: Schema.String.annotate({ description: "Unique identifier of the issue to update" }),
  title: Schema.optional(Schema.String).annotate({ description: "Short label" }),
  content: Schema.optional(Schema.String).annotate({ description: "Brief description shown in list rows" }),
  description: Schema.optional(Schema.String).annotate({ description: "Rich-text markdown body" }),
  status: Schema.optional(Schema.String).annotate({
    description:
      "Linear workflow state name (e.g., 'Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Canceled', 'Duplicate'). Can be used to transition any issue — including Archived ones — between statuses.",
  }),
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
  issue?: Issue.Info
}

/**
 * Discriminated union for the update outcome, mirroring `issue_delete.ts`.
 * `Tool.define` requires the execute Effect to have error channel `never`,
 * so typed errors (`IssueNotFoundError`, `IssueHierarchyError`) are caught
 * via `Effect.catchTag` and folded into this union. Defects (Interrupt/Die)
 * propagate naturally.
 *
 * ADR-0005 D2 (Linear-linked refusal) was superseded 2026-07-20: the agent
 * now edits Linear-linked issues directly in the local IssueTable, then
 * optionally calls `issue_sync push` to sync to Linear — symmetric with the
 * UI path. See ADR-0005 Amendment 2026-07-20 §D2 for the rationale.
 */
type UpdateOutcome =
  | { ok: true; issue: Issue.Info }
  | { ok: false; reason: "hierarchy" | "not_found"; detail: string }

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
          const directory = yield* InstanceState.directory

          // Construct the patch as an object literal (not via mutation) because
          // `Issue.Info` is inferred as `readonly` from `Schema.Schema.Type` —
          // field assignment on a `Partial<Issue.Info>` would fail typecheck.
          // Conditional spreads produce a fresh mutable object each call.
          const patch: Partial<Issue.Info> = {
            ...(params.title !== undefined ? { title: params.title } : {}),
            ...(params.content !== undefined ? { content: params.content } : {}),
            ...(params.description !== undefined ? { description: params.description } : {}),
            ...(params.status !== undefined ? { status: params.status } : {}),
            ...(params.priority !== undefined ? { priority: params.priority } : {}),
            ...(params.due_date !== undefined ? { due_date: params.due_date } : {}),
            ...(params.assignee_id !== undefined ? { assignee_id: params.assignee_id } : {}),
            ...(params.parent_id !== undefined ? { parent_id: params.parent_id } : {}),
            ...(params.level !== undefined ? { level: params.level } : {}),
            ...(params.labels !== undefined ? { labels: [...params.labels] } : {}),
            ...(params.position !== undefined ? { position: params.position } : {}),
          }

          const outcome = yield* issue.update({ directory, id: params.id, patch }).pipe(
            Effect.map((updated): UpdateOutcome => ({ ok: true, issue: updated })),
            Effect.catchTag("Issue.HierarchyError", (e) =>
              Effect.succeed<UpdateOutcome>({
                ok: false,
                reason: "hierarchy",
                detail: e.reason,
              }),
            ),
            Effect.catchTag("Issue.NotFoundError", (e) =>
              Effect.succeed<UpdateOutcome>({
                ok: false,
                reason: "not_found",
                detail: e.context ?? e.id,
              }),
            ),
          )

          if (!outcome.ok) {
            return {
              title: `issue_update: ${params.id} failed (${outcome.reason})`,
              output: JSON.stringify({ updated: false, error: outcome.detail, reason: outcome.reason }, null, 2),
              metadata: {} as Metadata,
            }
          }

          // ADR-0005 D6: strip sync-internal bookkeeping fields before
          // exposing to the agent.
          const agentIssue = Issue.toAgentInfo(outcome.issue)

          return {
            title: `issue_update: ${outcome.issue.title}`,
            output: JSON.stringify(agentIssue, null, 2),
            metadata: { issue: agentIssue } as Metadata,
          }
        }),
    }
  }),
)
