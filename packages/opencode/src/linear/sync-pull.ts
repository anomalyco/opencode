import { Context, Effect, Schema } from "effect"
import { ISSUE } from "./tool-names"
import { LinearMcpClient } from "./mcp-client"
import { LinearMcpError } from "./mcp-client"
import { Todo } from "@/session/todo"
import { Config } from "@/config/config"
import { Bus } from "@/bus"
import { SessionID } from "@/session/schema"

/** Pull service: converts Linear issues to local todos via MCP. */
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
    /** Number of issues successfully pulled into local todos. */
    pulled: Schema.Number,
    /** Number of issues skipped (already exist locally by linear_issue_id or inactive state). */
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

  /** Maximum number of concurrent pull/todo-create operations. */
  export const DEFAULT_BATCH = 10

  /**
   * Map a Linear state type string to an OpenCode todo status.
   * - "unstarted" → "pending"
   * - "started" → "in_progress"
   * - "completed" → "completed"
   * - "canceled"/"cancelled" → "cancelled"
   * - any other value → "pending" (fallback)
   */
  export const mapStateToStatus = (
    linearState: string,
  ): "pending" | "in_progress" | "completed" | "cancelled" => {
    switch (linearState) {
      case "unstarted":
        return "pending"
      case "started":
        return "in_progress"
      case "completed":
        return "completed"
      case "canceled":
      case "cancelled":
        return "cancelled"
      default:
        return "pending"
    }
  }

  /**
   * Map a Linear priority number (0-4) to a todo priority string.
   * - 1 → "urgent", 2 → "high", 3 → "medium", 4 → "low"
   * - 0 or any other value → "none"
   */
  export const mapReversePriority = (p: number): string => {
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

  /** Parse the MCP callTool response for list_issues to extract node array */
  const parseIssues = (
    raw: unknown,
  ): { nodes: unknown[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string } } => {
    const def = { nodes: [] as unknown[], pageInfo: undefined as { hasNextPage?: boolean; endCursor?: string } | undefined }

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

  /** Extract label names from Linear's GraphQL label connection pattern */
  const extractLabels = (raw: unknown): string[] => {
    if (!raw || typeof raw !== "object") return []
    const r = raw as Record<string, unknown>
    if (!Array.isArray(r.nodes)) return []
    return r.nodes
      .filter((n): n is Record<string, unknown> => typeof n === "object" && n !== null)
      .map((n) => (typeof n.name === "string" ? n.name : ""))
      .filter(Boolean)
  }

  /** Map a Linear issue graph node to Todo.Info fields */
  const mapIssueToTodo = (issue: unknown): Partial<Todo.Info> | undefined => {
    if (!issue || typeof issue !== "object") return
    const i = issue as Record<string, unknown>

    const state = (typeof i.state === "object" && i.state !== null
      ? (i.state as Record<string, unknown>).type
      : undefined) as string | undefined

    const parentId = (typeof i.parent === "object" && i.parent !== null
      ? (i.parent as Record<string, unknown>).id
      : undefined) as string | undefined

    return {
      linear_issue_id: typeof i.id === "string" ? i.id : undefined,
      title: typeof i.title === "string" ? i.title : "Untitled",
      description: typeof i.description === "string" ? i.description : "",
      status: state ? mapStateToStatus(state) : "pending",
      priority: typeof i.priority === "number" ? mapReversePriority(i.priority) : "none",
      labels: extractLabels(i.labels),
      due_date: typeof i.dueDate === "string" ? i.dueDate : undefined,
      team_id: typeof i.teamId === "string" ? i.teamId : undefined,
      project_id: typeof i.projectId === "string" ? i.projectId : undefined,
      assignee_id: typeof i.assigneeId === "string" ? i.assigneeId : undefined,
      parent_id: parentId,
      level: 0,
    }
  }

  /** Active Linear state types to pull (ignore completed/cancelled) */
  const ACTIVE_STATES = new Set(["unstarted", "started"])

  /**
   * Pull Linear issues into local todos.
   *
   * - Fetches all issues for the configured project via `list_issues` (paginated, 50/page)
   * - Filters to active states only: `unstarted` and `started`
   * - Skips issues whose `linear_issue_id` already exists locally (dedup)
   * - Resolves parent-child relationships from Linear to local `parent_id`
   * - Creates todos in batch with configurable concurrency
   *
   * Returns a Result with pulled/skipped/failed counts and per-error details.
   */
  export const pull = Effect.fn("SyncPull.pull")(function* (input: {
    sessionID: SessionID
  }) {
    const cfgSvc = yield* Config.Service
    const info = yield* cfgSvc.get()
    const cfg = info.linear ?? Config.linear()

    if (!cfg.projectId || !cfg.teamId) {
      return yield* Effect.fail(
        new Error({ message: "Linear config missing projectId or teamId" }),
      )
    }

    const client = yield* Client
    const todoSvc = yield* Todo.Service
    const existing = yield* todoSvc.get(input.sessionID)

    // Build lookup: linear_issue_id → local todo id
    const byLinearId = new Map<string, string>()
    for (const t of existing) {
      if (t.linear_issue_id) byLinearId.set(t.linear_issue_id, t.id!)
    }

    let pulled = 0
    let skipped = 0
    const ids: string[] = []
    const errors: Array<{ linearIssueId: string; error: string }> = []

    // Paginate through all issues
    const allIssues: unknown[] = []
    let cursor: string | undefined
    let hasNextPage = true

    while (hasNextPage) {
      const args: Record<string, unknown> = { project: cfg.projectId, limit: 50 }
      if (cursor) args.cursor = cursor

      const raw = yield* client.callTool(ISSUE.LIST, args).pipe(
        Effect.catch((e: unknown) => {
          const msg = LinearMcpError.isInstance(e) ? String(e.data.message ?? "") : e instanceof Error ? e.message : String(e)
          return Effect.succeed({ _error: true, message: msg })
        }),
      )

      if (typeof raw === "object" && raw !== null && "_error" in raw) {
        const msg = String((raw as Record<string, unknown>).message ?? "unknown MCP error")
        errors.push({ linearIssueId: "<batch>", error: msg })
        break
      }

      const parsed = parseIssues(raw)
      for (const node of parsed.nodes) {
        allIssues.push(node)
      }

      if (parsed.pageInfo?.hasNextPage && parsed.pageInfo?.endCursor) {
        cursor = parsed.pageInfo.endCursor
      } else {
        hasNextPage = false
      }
    }

    if (allIssues.length === 0) {
      return new Result({ pulled: 0, skipped: 0, failed: errors.length, ids, errors })
    }

    // Filter to active issues (unstarted/started), dedupe by linear_issue_id
    const seen = new Set<string>()
    const active: Array<{ issue: unknown; fields: Partial<Todo.Info> }> = []

    for (const issue of allIssues) {
      const i = issue as Record<string, unknown>
      const rawState = (typeof i.state === "object" && i.state !== null
        ? (i.state as Record<string, unknown>).type
        : undefined) as string | undefined

      if (!rawState || !ACTIVE_STATES.has(rawState)) continue

      const fields = mapIssueToTodo(issue)
      if (!fields?.linear_issue_id) continue
      if (seen.has(fields.linear_issue_id)) continue
      seen.add(fields.linear_issue_id)

      // Resolve parent: if issue has a parent and that parent was already pulled, link it
      if (fields.parent_id && byLinearId.has(fields.parent_id)) {
        fields.parent_id = byLinearId.get(fields.parent_id)
      } else {
        fields.parent_id = undefined
      }

      active.push({ issue, fields })
    }

    if (active.length === 0) {
      skipped = seen.size
      return new Result({ pulled: 0, skipped, failed: errors.length, ids, errors })
    }

    yield* Effect.all(
      active.map(({ fields }) =>
        Effect.gen(function* () {
          const lid = fields.linear_issue_id!

          if (byLinearId.has(lid)) {
            skipped++
            return
          }

          const result = yield* todoSvc.create({
            sessionID: input.sessionID,
            todo: {
              content: fields.title || "Untitled",
              status: fields.status || "pending",
              priority: fields.priority || "none",
              level: fields.level ?? 0,
              description: fields.description || "",
              labels: fields.labels || [],
              title: fields.title,
              ...fields,
            } as Todo.Info,
          }).pipe(
            Effect.catch((e: unknown) => {
              const msg = LinearMcpError.isInstance(e) ? String(e.data.message ?? "") : e instanceof Error ? e.message : String(e)
              return Effect.succeed({ _error: true, message: msg, issueId: lid })
            }),
          )

          if (typeof result === "object" && result !== null && "_error" in result) {
            const r = result as Record<string, unknown>
            errors.push({
              linearIssueId: (r.issueId as string) || lid,
              error: (r.message as string) || "unknown",
            })
            return
          }

          // Track for parent resolution of subsequent issues
          const created = result as Todo.Info
          if (created.id && lid) byLinearId.set(lid, created.id)

          pulled++
          ids.push(lid)
        }),
      ),
      { concurrency: DEFAULT_BATCH, discard: true },
    )

    return new Result({ pulled, skipped, failed: errors.length, ids, errors })
  })

  /**
   * Subscribe to local todo progression events and resync to Linear.
   *
   * When a todo is progressed, checks if it has a `linear_issue_id`
   * and pushes the update back to Linear via `SyncPush.push`.
   *
   * @param sessionID - The session to watch for progress events
   */
  export const subscribeAndResync = Effect.fn("SyncPull.subscribeAndResync")(function* (
    sessionID: SessionID,
  ) {
    yield* Effect.logDebug("subscribeAndResync started", { sessionID: String(sessionID) })
    // TODO T17: wire to real Bus.subscribe for Todo.Progressed events
    // When a todo is progressed, check if it has a linear_issue_id
    // and push the update back to Linear via SyncPush.push
    yield* Effect.void
  })
}
