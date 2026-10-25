import { Effect, Schema } from "effect"
import { Storage } from "@/storage/storage"
import { Tool } from "./tool"
import CREATE_DESCRIPTION from "./tasks-create.txt"
import UPDATE_DESCRIPTION from "./tasks-update.txt"
import LIST_DESCRIPTION from "./tasks-list.txt"

export const Status = Schema.Literals(["pending", "in_progress", "completed", "cancelled"])
export type Status = Schema.Schema.Type<typeof Status>

export interface Info {
  id: string
  subject: string
  description?: string
  status: Status
  blockers: string[]
}

/** A blocker stops blocking once it is completed or cancelled. */
export function blocked(tasks: readonly Info[], task: Info) {
  return task.blockers.filter((id) => {
    const blocker = tasks.find((item) => item.id === id)
    if (!blocker) return false
    return blocker.status !== "completed" && blocker.status !== "cancelled"
  })
}

/** Validate and build a new task, assigning the next numeric id. */
export function create(
  tasks: readonly Info[],
  input: { subject: string; description?: string; blockers?: readonly string[] },
): { ok: true; task: Info } | { ok: false; reason: string } {
  if (!input.subject.trim()) return { ok: false, reason: "subject must not be empty" }
  const known = tasks.map((task) => task.id)
  const missing = (input.blockers ?? []).filter((id) => !known.includes(id))
  if (missing.length) return { ok: false, reason: `unknown blocker task ids: ${missing.join(", ")}` }
  const next = tasks.reduce((max, task) => Math.max(max, Number(task.id) || 0), 0) + 1
  return {
    ok: true,
    task: {
      id: String(next),
      subject: input.subject,
      ...(input.description === undefined ? {} : { description: input.description }),
      status: "pending",
      blockers: [...new Set(input.blockers ?? [])],
    },
  }
}

/**
 * Validate a task update and return the new task list. Enforces legal status
 * transitions (completed and cancelled are terminal), at most one in_progress
 * task, and completion only when every blocker is completed or cancelled.
 */
export function transition(
  tasks: readonly Info[],
  input: { id: string; subject?: string; description?: string; status?: Status; blockers?: readonly string[] },
): { ok: true; tasks: Info[] } | { ok: false; reason: string } {
  const current = tasks.find((task) => task.id === input.id)
  if (!current) {
    const known = tasks.map((task) => task.id).join(", ")
    return { ok: false, reason: `unknown task id "${input.id}" (known ids: ${known || "none"})` }
  }

  if (input.subject !== undefined && !input.subject.trim()) return { ok: false, reason: "subject must not be empty" }

  if (input.blockers) {
    if (input.blockers.includes(input.id)) return { ok: false, reason: `task ${input.id} cannot block itself` }
    const known = tasks.map((task) => task.id)
    const missing = input.blockers.filter((id) => !known.includes(id))
    if (missing.length) return { ok: false, reason: `unknown blocker task ids: ${missing.join(", ")}` }
  }

  const updated: Info = {
    ...current,
    subject: input.subject ?? current.subject,
    ...(input.description === undefined ? {} : { description: input.description }),
    status: input.status ?? current.status,
    blockers: input.blockers ? [...new Set(input.blockers)] : current.blockers,
  }

  if (input.status !== undefined && input.status !== current.status) {
    if (current.status === "completed" || current.status === "cancelled") {
      return { ok: false, reason: `task ${input.id} is ${current.status} and cannot change status` }
    }
    if (input.status === "in_progress") {
      const active = tasks.find((task) => task.status === "in_progress" && task.id !== input.id)
      if (active) {
        return {
          ok: false,
          reason: `task ${active.id} is already in_progress; only one task may be in_progress at a time`,
        }
      }
    }
    if (input.status === "completed") {
      const remaining = blocked(
        tasks.map((task) => (task.id === input.id ? updated : task)),
        updated,
      )
      if (remaining.length) {
        return { ok: false, reason: `task ${input.id} has incomplete blockers: ${remaining.join(", ")}` }
      }
    }
  }

  return { ok: true, tasks: tasks.map((task) => (task.id === input.id ? updated : task)) }
}

export function render(tasks: readonly Info[]) {
  if (tasks.length === 0) return "No tasks exist for this session."
  return tasks
    .map((task) => {
      const remaining = blocked(tasks, task)
      return [
        `[${task.id}] ${task.status}: ${task.subject}`,
        task.description ? `  description: ${task.description}` : undefined,
        task.blockers.length ? `  blockers: ${task.blockers.join(", ")}` : undefined,
        remaining.length ? `  blocked by: ${remaining.join(", ")}` : undefined,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n")
    })
    .join("\n")
}

const KEY = "session_task"

// A missing key means no tasks yet; any other storage failure must not be
// mistaken for an empty list, or a later write would erase persisted tasks.
const load = Effect.fnUntraced(function* (storage: Storage.Interface, sessionID: string) {
  return yield* storage.read<Info[]>([KEY, sessionID]).pipe(
    Effect.catchTag("NotFoundError", () => Effect.succeed([] as Info[])),
    Effect.orDie,
  )
})

export const CreateParameters = Schema.Struct({
  subject: Schema.String.annotate({ description: "Brief imperative summary of the task" }),
  description: Schema.optional(Schema.String).annotate({ description: "Optional longer detail for the task" }),
  blockers: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Optional ids of existing tasks that must finish before this task can be completed",
  }),
})

export const TaskCreateTool = Tool.define(
  "task_create",
  Effect.gen(function* () {
    const storage = yield* Storage.Service

    return {
      description: CREATE_DESCRIPTION,
      parameters: CreateParameters,
      execute: (params: Schema.Schema.Type<typeof CreateParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "task_create",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          const tasks = yield* load(storage, ctx.sessionID)
          const result = create(tasks, {
            subject: params.subject,
            description: params.description,
            blockers: params.blockers,
          })
          if (!result.ok) throw new Error(result.reason)

          yield* storage.write([KEY, ctx.sessionID], [...tasks, result.task]).pipe(Effect.orDie)

          return {
            title: `Created task ${result.task.id}`,
            output: `Created task ${result.task.id}: ${result.task.subject}`,
            metadata: { id: result.task.id },
          }
        }),
    }
  }),
)

export const UpdateParameters = Schema.Struct({
  id: Schema.String.annotate({ description: "The id of the task to update, as returned by task_create or task_list" }),
  subject: Schema.optional(Schema.String).annotate({ description: "New subject for the task" }),
  description: Schema.optional(Schema.String).annotate({ description: "New description for the task" }),
  status: Schema.optional(Status).annotate({
    description: "New status: pending, in_progress, completed, or cancelled",
  }),
  blockers: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Replacement blocker list of existing task ids",
  }),
})

export const TaskUpdateTool = Tool.define(
  "task_update",
  Effect.gen(function* () {
    const storage = yield* Storage.Service

    return {
      description: UPDATE_DESCRIPTION,
      parameters: UpdateParameters,
      execute: (params: Schema.Schema.Type<typeof UpdateParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "task_update",
            patterns: [params.id],
            always: ["*"],
            metadata: {},
          })

          const tasks = yield* load(storage, ctx.sessionID)
          const result = transition(tasks, {
            id: params.id,
            subject: params.subject,
            description: params.description,
            status: params.status,
            blockers: params.blockers,
          })
          if (!result.ok) throw new Error(result.reason)

          yield* storage.write([KEY, ctx.sessionID], result.tasks).pipe(Effect.orDie)
          const updated = result.tasks.find((task) => task.id === params.id)
          if (!updated) throw new Error(`task ${params.id} missing after update`)

          return {
            title: `Updated task ${params.id}`,
            output: `Task ${updated.id} is now ${updated.status}: ${updated.subject}`,
            metadata: { id: updated.id, status: updated.status },
          }
        }),
    }
  }),
)

export const ListParameters = Schema.Struct({})

export const TaskListTool = Tool.define(
  "task_list",
  Effect.gen(function* () {
    const storage = yield* Storage.Service

    return {
      description: LIST_DESCRIPTION,
      parameters: ListParameters,
      execute: (_params: Schema.Schema.Type<typeof ListParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "task_list",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          const tasks = yield* load(storage, ctx.sessionID)

          return {
            title: `${tasks.filter((task) => task.status !== "completed" && task.status !== "cancelled").length} open tasks`,
            output: render(tasks),
            metadata: {
              count: tasks.length,
              tasks: tasks.map((task) => ({ ...task, blocked: blocked(tasks, task) })),
            },
          }
        }),
    }
  }),
)
