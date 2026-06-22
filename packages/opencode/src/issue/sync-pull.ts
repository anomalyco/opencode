import { Context, Effect, Schema } from "effect"
import { ISSUE } from "./tool-names"
import { LinearMcpClient } from "./mcp-client"
import { LinearMcpError } from "./mcp-client"
import { Issue } from "./issue"
import { Config } from "@/config/config"

/**
 * SyncPull — snapshot-import Linear issues into the local IssueTable
 * (workspace-scoped, per ADR-0001 D1, ADR-0002 D5–D7).
 *
 * `pull({ directory })` fetches active Linear issues for the configured
 * project and inserts any whose `linear_issue_id` is not already linked
 * locally. Existing local rows are NEVER updated by a pull — local
 * edits are first-class (ADR-0002 D5). The pull does not skip on
 * "nothing to do" — it always runs and returns honest counts
 * (ADR-0002 D6).
 */
export namespace SyncPull {
  /**
   * Effect context tag for the Linear MCP client consumed by pull().
   * Must be provided in the layer that calls pull().
   */
  export const Client = Context.Service<LinearMcpClient>("@opencode/SyncPull/Client")

  /** Fatal error when pull cannot proceed at all (e.g., missing config). */
  export class Error extends Schema.TaggedErrorClass<Error>()("SyncPullError", {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  }) {}

  /** Summary of a pull operation. */
  export class Result extends Schema.Class<Result>("SyncPullResult")({
    /** Number of issues newly inserted into the local IssueTable. */
    pulled: Schema.Number,
    /** Number of Linear issues that already had a local row (skipped, not updated). */
    skipped: Schema.Number,
    /** Number of issues that failed to pull. */
    failed: Schema.Number,
    /** Linear issue IDs that were pulled. */
    ids: Schema.Array(Schema.String),
    /** Per-issue error details for failed pulls. */
    errors: Schema.Array(
      Schema.Struct({
        linearIssueId: Schema.String,
        error: Schema.String,
      }),
    ),
  }) {}

  /** Maximum number of concurrent pull/issue-create operations. */
  export const DEFAULT_BATCH = 10

  /**
   * Map a Linear state.type string to an Issue.Status.
   * - "unstarted" → "todo"
   * - "started" → "in_progress"
   * - "completed" → "done"
   * - "canceled"/"cancelled" → "canceled"
   * - any other value → "todo" (fallback)
   */
  export const mapStateToStatus = (linearState: string): Issue.Status => {
    switch (linearState) {
      case "unstarted":
        return "todo"
      case "started":
        return "in_progress"
      case "completed":
        return "done"
      case "canceled":
      case "cancelled":
        return "canceled"
      default:
        return "todo"
    }
  }

  /**
   * Map a Linear priority number (1–4) to an Issue.Priority.
   * - 1 → "urgent", 2 → "high", 3 → "medium", 4 → "low"
   * - 0 or any other value → "none"
   */
  export const mapReversePriority = (p: number): Issue.Priority => {
    switch (p) {
      case 1:
        return "urgent"
      case 2:
        return "high"
      case 3:
        return "medium"
      case 4:
        return "low"
      default:
        return "none"
    }
  }

  const safeParse = (text: string): unknown => {
    try {
      return JSON.parse(text)
    } catch {
      return
    }
  }

  const parseIssues = (
    raw: unknown,
  ): { nodes: unknown[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string } } => {
    const def = {
      nodes: [] as unknown[],
      pageInfo: undefined as { hasNextPage?: boolean; endCursor?: string } | undefined,
    }

    if (!raw || typeof raw !== "object") return def
    const r = raw as Record<string, unknown>

    if (Array.isArray(r.content)) {
      for (const item of r.content) {
        if (typeof item !== "object" || !item) continue
        const c = item as Record<string, unknown>
        if (c.type === "text" && typeof c.text === "string") {
          const parsed = safeParse(c.text)
          if (!parsed || typeof parsed !== "object") continue
          const p = parsed as Record<string, unknown>

          if (p.data && typeof p.data === "object") {
            const d = p.data as Record<string, unknown>
            if (d.issues && typeof d.issues === "object") {
              const issues = d.issues as Record<string, unknown>
              if (Array.isArray(issues.nodes)) {
                return {
                  nodes: issues.nodes,
                  pageInfo: issues.pageInfo as { hasNextPage?: boolean; endCursor?: string } | undefined,
                }
              }
            }
          }
        }
      }
    }

    return def
  }

  const extractLabels = (raw: unknown): string[] => {
    if (!raw || typeof raw !== "object") return []
    const r = raw as Record<string, unknown>
    if (!Array.isArray(r.nodes)) return []
    return r.nodes
      .filter((n): n is Record<string, unknown> => typeof n === "object" && n !== null)
      .map((n) => (typeof n.name === "string" ? n.name : ""))
      .filter(Boolean)
  }

  /** Active Linear state.types to pull (skip completed/canceled). */
  const ACTIVE_STATES = new Set(["unstarted", "started"])

  /**
   * Pull Linear issues into the local IssueTable for the given workspace.
   *
   * - Fetches all issues for the configured project via `list_issues` (paginated, 50/page)
   * - Filters to active states only
   * - Skips issues whose `linear_issue_id` is already linked locally
   * - Inserts new rows; existing rows are never updated
   * - Returns honest counts (pulled/skipped/failed) — no "already up to date" euphemism
   */
  export const pull = Effect.fn("SyncPull.pull")(function* (input: { directory: string }) {
    const cfgSvc = yield* Config.Service
    const info = yield* cfgSvc.get()
    const cfg = info.linear ?? Config.linear()

    if (!cfg.projectId || !cfg.teamId) {
      return yield* Effect.fail(new Error({ message: "Linear config missing projectId or teamId" }))
    }

    const client = yield* Client
    const issueSvc = yield* Issue.Service
    const existing = yield* issueSvc.get({ directory: input.directory })

    const linked = new Set<string>()
    for (const i of existing) {
      if (i.linear_issue_id) linked.add(i.linear_issue_id)
    }

    let pulled = 0
    let skipped = 0
    const ids: string[] = []
    const errors: Array<{ linearIssueId: string; error: string }> = []

    const allIssues: unknown[] = []
    let cursor: string | undefined
    let hasNextPage = true

    while (hasNextPage) {
      const args: Record<string, unknown> = { project: cfg.projectId, limit: 50 }
      if (cursor) args.cursor = cursor

      const raw = yield* client.callTool(ISSUE.LIST, args).pipe(
        Effect.catch((e: unknown) => {
          const msg = LinearMcpError.isInstance(e)
            ? String(e.data.message ?? "")
            : e instanceof Error
              ? e.message
              : String(e)
          return Effect.succeed({ _error: true, message: msg })
        }),
      )

      if (typeof raw === "object" && raw !== null && "_error" in raw) {
        const msg = String((raw as Record<string, unknown>).message ?? "unknown MCP error")
        errors.push({ linearIssueId: "<batch>", error: msg })
        break
      }

      const parsed = parseIssues(raw)
      for (const node of parsed.nodes) allIssues.push(node)

      if (parsed.pageInfo?.hasNextPage && parsed.pageInfo?.endCursor) {
        cursor = parsed.pageInfo.endCursor
      } else {
        hasNextPage = false
      }
    }

    const toInsert: Array<{ linearIssueId: string; fields: Partial<Issue.Info> }> = []

    for (const issue of allIssues) {
      const i = issue as Record<string, unknown>
      const rawState = (
        typeof i.state === "object" && i.state !== null ? (i.state as Record<string, unknown>).type : undefined
      ) as string | undefined

      if (!rawState || !ACTIVE_STATES.has(rawState)) continue

      const linearId = typeof i.id === "string" ? i.id : undefined
      if (!linearId) continue
      if (linked.has(linearId)) {
        skipped++
        continue
      }

      toInsert.push({
        linearIssueId: linearId,
        fields: {
          content: typeof i.title === "string" ? i.title : "Untitled",
          title: typeof i.title === "string" ? i.title : "Untitled",
          description: typeof i.description === "string" ? i.description : "",
          status: rawState ? mapStateToStatus(rawState) : "todo",
          priority: typeof i.priority === "number" ? mapReversePriority(i.priority) : "none",
          labels: extractLabels(i.labels),
          due_date: typeof i.dueDate === "string" ? i.dueDate : undefined,
          linear_issue_id: linearId,
          linear_team_id: typeof i.teamId === "string" ? i.teamId : cfg.teamId,
          linear_project_id: typeof i.projectId === "string" ? i.projectId : cfg.projectId,
          assignee_id: typeof i.assigneeId === "string" ? i.assigneeId : undefined,
          level: 0,
        },
      })
    }

    yield* Effect.all(
      toInsert.map(({ linearIssueId, fields }) =>
        Effect.gen(function* () {
          const created = yield* issueSvc.create({ directory: input.directory, issue: fields }).pipe(
            Effect.catch((e: unknown) => {
              const msg = LinearMcpError.isInstance(e)
                ? String(e.data.message ?? "")
                : e instanceof Error
                  ? e.message
                  : String(e)
              return Effect.succeed({ _error: true, message: msg, issueId: linearIssueId })
            }),
          )

          if (typeof created === "object" && created !== null && "_error" in created) {
            const r = created as Record<string, unknown>
            errors.push({
              linearIssueId: (r.issueId as string) || linearIssueId,
              error: (r.message as string) || "unknown",
            })
            return
          }

          pulled++
          ids.push(linearIssueId)
        }),
      ),
      { concurrency: DEFAULT_BATCH, discard: true },
    )

    return new Result({ pulled, skipped, failed: errors.length, ids, errors })
  })
}
