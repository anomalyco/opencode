import { Context, Effect, Schema } from "effect"
import { ISSUE } from "./tool-names"
import { LinearMcpClient } from "./mcp-client"
import { Todo } from "@/session/todo"
import { Config } from "@/config/config"
import { Bus } from "@/bus"
import { SessionID } from "@/session/schema"

/** Push service: converts local todos to Linear issues via MCP. */
export namespace SyncPush {
  /**
   * Effect context tag for the Linear MCP client consumed by push().
   * Must be provided in the layer that calls push().
   */
  export const Client = Context.Service<LinearMcpClient>("@opencode/SyncPush/Client")

  /** Fatal error when push cannot proceed at all (e.g., missing config). */
  export class Error extends Schema.TaggedErrorClass<Error>()("SyncPushError", {
    message: Schema.String,
    todoID: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect),
  }) {}

  /** Summary of a push operation. */
  export class Result extends Schema.Class<Result>("SyncPushResult")({
    /** Number of todos successfully pushed to Linear. */
    pushed: Schema.Number,
    /** Number of todos that failed to push. */
    failed: Schema.Number,
    /** Linear issue IDs created by the push. */
    ids: Schema.Array(Schema.String),
    /** Per-todo error details for failed pushes. */
    errors: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        message: Schema.String,
      }),
    ),
  }) {}

  /** Maximum number of concurrent push operations. */
  export const DEFAULT_BATCH = 10

  /** Map a todo priority string to a Linear priority number (0=no priority, 1=urgent…4=low). */
  export const mapPriority = (p: "high" | "medium" | "low" | "none" | "urgent" | undefined): 0 | 1 | 2 | 3 | 4 => {
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

  /** Map a Todo.Info + Linear config into the input shape for MCP save_issue. */
  export const mapTodoToIssue = Effect.fn("SyncPush.mapTodoToIssue")(function* (
    todo: Todo.Info,
    cfg: Config.Linear,
  ) {
    const desc = todo.description || todo.content || ""
    return {
      title: todo.title || todo.content || "Untitled",
      description: desc,
      priority: mapPriority(todo.priority as "high" | "medium" | "low" | "none" | "urgent" | undefined),
      teamId: cfg.teamId,
      projectId: cfg.projectId,
      ...(todo.assignee_id ? { assigneeId: todo.assignee_id } : {}),
    }
  })

  const safeParse = (text: string): unknown => {
    try {
      return JSON.parse(text)
    } catch {
      return
    }
  }

  const extractId = (raw: unknown): string | undefined => {
    if (!raw || typeof raw !== "object") return
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
            if (d.saveIssue && typeof d.saveIssue === "object") {
              const s = d.saveIssue as Record<string, unknown>
              if (typeof s.id === "string") return s.id
            }
            if (d.issue && typeof d.issue === "object") {
              const s = d.issue as Record<string, unknown>
              if (typeof s.id === "string") return s.id
            }
          }

          if (p.saveIssue && typeof p.saveIssue === "object") {
            const s = p.saveIssue as Record<string, unknown>
            if (typeof s.id === "string") return s.id
          }
          if (typeof p.id === "string") return p.id
          if (typeof p.identifier === "string") return p.identifier
        }
      }
    }

    if (typeof r.id === "string") return r.id
    return
  }

  /**
   * Push todos to Linear as issues.
   *
   * - Skips todos that already have a `linear_issue_id`
   * - Processes todos concurrently (up to DEFAULT_BATCH)
   * - On success, updates the todo with the new `linear_issue_id`
   * - On per-todo failure, collects the error and continues
   *
   * Returns a Result with pushed/failed counts, issue IDs, and per-error details.
   */
  export const push = Effect.fn("SyncPush.push")(function* (input: {
    sessionID: SessionID
    todoIds?: string[] | "all"
  }) {
    const cfgSvc = yield* Config.Service
    const info = yield* cfgSvc.get()
    const cfg = info.linear ?? Config.linear()

    if (!cfg.projectId || !cfg.teamId) {
      return yield* Effect.fail(
        new Error({ message: "Linear config missing projectId or teamId" }),
      )
    }

    const todoSvc = yield* Todo.Service
    const all = yield* todoSvc.get(input.sessionID)

    let todos: Todo.Info[]
    if (input.todoIds === "all" || !input.todoIds) {
      todos = all
    } else {
      const set = new Set(input.todoIds)
      todos = all.filter((t) => !!t.id && set.has(t.id))
    }

    todos = todos.filter((t) => !t.linear_issue_id)

    if (todos.length === 0) {
      return new Result({ pushed: 0, failed: 0, ids: [], errors: [] })
    }

    const client = yield* Client
    const bus = yield* Bus.Service
    const ids: string[] = []
    const errors: Array<{ id: string; message: string }> = []

    yield* Effect.all(
      todos.map((todo) =>
        Effect.gen(function* () {
          if (!todo.id) {
            errors.push({ id: "<unknown>", message: "Todo missing id" })
            return
          }
          const issue = yield* mapTodoToIssue(todo, cfg)

          const raw = yield* client.callTool(ISSUE.SAVE, {
            input: issue,
          }).pipe(
            Effect.catch((e: unknown) =>
              Effect.succeed({ _error: true, message: String(e) }),
            ),
          )

          if (typeof raw === "object" && raw !== null && "_error" in raw) {
            const msg = String((raw as Record<string, unknown>).message ?? "unknown MCP error")
            errors.push({ id: todo.id, message: msg })
            return
          }

          const linearId = extractId(raw)
          if (!linearId) {
            errors.push({ id: todo.id, message: "Failed to extract Linear issue ID from response" })
            return
          }

          yield* todoSvc.update({
            sessionID: input.sessionID,
            id: todo.id,
            patch: { linear_issue_id: linearId },
          })

          yield* bus.publish(Todo.Event.Updated, {
            sessionID: input.sessionID,
            todos: all,
          })

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
