import { Context, Effect, Schema } from "effect"
import { ISSUE } from "./tool-names"
import { LinearMcpClient } from "./mcp-client"
import { Issue } from "./issue"
import { Config } from "@/config/config"
import { Database, eq, and } from "../storage/db"
import { IssueTable } from "./issue.sql"

/**
 * SyncPush — push local IssueTable changes back to Linear (ADR-0002 D8).
 *
 * For each issue in the workspace that has a `linear_issue_id` AND has
 * been updated locally since the last successful push (compared via
 * `time_updated > last_pushed_at`), call `save_issue` to write the
 * changed fields to Linear. New issues are NOT created by bulk push;
 * publishing a new issue is an explicit per-row action (future ADR).
 *
 * On success, `last_pushed_at` is set to the same `Date.now()` stamp as
 * `time_updated` (via a single SQL UPDATE). This keeps the two columns
 * in lockstep, so a row that has not changed since the last push will
 * not be re-pushed on the next call (filter is `last_pushed_at <
 * time_updated`, which is false when they're equal).
 */
export namespace SyncPush {
  /**
   * Effect context tag for the Linear MCP client consumed by push().
   * Must be provided in the layer that calls push().
   */
  export const Client = Context.Service<LinearMcpClient>("@opencode/SyncPush/Client")

  /** Fatal error when push cannot proceed at all (e.g., missing config). */
  export class Error extends Schema.TaggedErrorClass<Error>()("SyncPushError", {
    message: Schema.String,
    issueID: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect),
  }) {}

  /** Summary of a push operation. */
  export class Result extends Schema.Class<Result>("SyncPushResult")({
    /** Number of issues successfully pushed to Linear. */
    pushed: Schema.Number,
    /** Number of issues that failed to push. */
    failed: Schema.Number,
    /** Linear issue IDs that were updated by the push. */
    ids: Schema.Array(Schema.String),
    /** Per-issue error details for failed pushes. */
    errors: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        message: Schema.String,
      }),
    ),
  }) {}

  /** Maximum number of concurrent push operations. */
  export const DEFAULT_BATCH = 10

  /** Map an Issue.Priority to a Linear priority number (0=no priority, 1=urgent…4=low). */
  export const mapPriority = (p: Issue.Priority): 0 | 1 | 2 | 3 | 4 => {
    switch (p) {
      case "urgent":
        return 1
      case "high":
        return 2
      case "medium":
        return 3
      case "low":
        return 4
      default:
        return 0
    }
  }

  /** Map an Issue.Status to a Linear state.type string. */
  export const mapStatusToStateType = (s: Issue.Status): string => {
    switch (s) {
      case "backlog":
      case "todo":
        return "unstarted"
      case "in_progress":
      case "in_review":
        return "started"
      case "done":
        return "completed"
      case "canceled":
        return "canceled"
      default:
        return "unstarted"
    }
  }

  /**
   * Push workspace issues to Linear. Skips issues with no `linear_issue_id`
   * (those are local-only) and skips issues whose `time_updated <= last_pushed_at`
   * (those have not changed since the last successful push).
   */
  export const push = Effect.fn("SyncPush.push")(function* (input: {
    directory: string
    issueIds?: string[] | "all"
  }) {
    const cfgSvc = yield* Config.Service
    const info = yield* cfgSvc.get()
    const cfg = info.linear ?? Config.linear()

    if (!cfg.projectId || !cfg.teamId) {
      return yield* Effect.fail(
        new Error({ message: "Linear config missing projectId or teamId" }),
      )
    }

    const issueSvc = yield* Issue.Service
    const all = yield* issueSvc.get({ directory: input.directory })

    let issues: Issue.Info[]
    if (input.issueIds === "all" || !input.issueIds) {
      issues = all
    } else {
      const set = new Set(input.issueIds)
      issues = all.filter((i) => set.has(i.id))
    }

    // Only push issues already linked to Linear; local-only issues need an
    // explicit "Publish to Linear" action (deferred).
    issues = issues.filter((i) => !!i.linear_issue_id)
    // And only push issues that have changed since the last successful push.
    issues = issues.filter((i) => i.last_pushed_at == null || i.last_pushed_at < i.time_updated)

    if (issues.length === 0) {
      return new Result({ pushed: 0, failed: 0, ids: [], errors: [] })
    }

    const client = yield* Client
    const ids: string[] = []
    const errors: Array<{ id: string; message: string }> = []

    yield* Effect.all(
      issues.map((issue) =>
        Effect.gen(function* () {
          const linearId = issue.linear_issue_id!
          const stateType = mapStatusToStateType(issue.status)

          const inputBody: Record<string, unknown> = {
            issueId: linearId,
            title: issue.title || issue.content || "Untitled",
            description: issue.description || issue.content || "",
            priority: mapPriority(issue.priority),
            stateType,
            teamId: issue.linear_team_id ?? cfg.teamId,
            projectId: issue.linear_project_id ?? cfg.projectId,
            ...(issue.assignee_id ? { assigneeId: issue.assignee_id } : {}),
            ...(issue.due_date ? { dueDate: issue.due_date } : {}),
          }

          const raw = yield* client.callTool(ISSUE.SAVE, { input: inputBody }).pipe(
            Effect.catch((e: unknown) =>
              Effect.succeed({ _error: true, message: String(e) }),
            ),
          )

          if (typeof raw === "object" && raw !== null && "_error" in raw) {
            const msg = String((raw as Record<string, unknown>).message ?? "unknown MCP error")
            errors.push({ id: issue.id, message: msg })
            return
          }

          yield* Effect.sync(() =>
            Database.use((db) => {
              const stamp = Date.now()
              db.update(IssueTable)
                .set({ last_pushed_at: stamp, time_updated: stamp })
                .where(
                  and(
                    eq(IssueTable.directory, input.directory),
                    eq(IssueTable.id, issue.id),
                  ),
                )
                .run()
            }),
          )

          ids.push(linearId)
        }),
      ),
      { concurrency: DEFAULT_BATCH, discard: true },
    )

    return new Result({
      pushed: ids.length,
      failed: errors.length,
      ids,
      errors,
    })
  })
}
