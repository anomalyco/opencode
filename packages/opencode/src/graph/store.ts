import z from "zod"
import { Database, and, eq, inArray } from "../storage/db"
import { TaskDependencyTable, TaskNodeTable } from "./graph.sql"

type TodoLike = {
  content: string
  status: string
  priority: string
}

function todoid(sessionID: string, position: number) {
  return `todo_${sessionID}_${position}`
}

function pos(data: unknown) {
  if (!data) return Number.POSITIVE_INFINITY
  if (typeof data !== "object") return Number.POSITIVE_INFINITY
  if (!("position" in data)) return Number.POSITIVE_INFINITY
  const value = (data as { position?: unknown }).position
  if (typeof value !== "number") return Number.POSITIVE_INFINITY
  return value
}

export namespace TaskGraph {
  export const Node = z
    .object({
      id: z.string(),
      session_id: z.string(),
      version: z.number().int(),
      type: z.string(),
      content: z.string(),
      status: z.string(),
      priority: z.string(),
      duration: z.number().int().nullable().optional(),
      tokens_used: z.number().int().nullable().optional(),
      result: z.string().nullable().optional(),
      data: z.unknown().nullable().optional(),
      time_created: z.number().int(),
      time_updated: z.number().int(),
    })
    .meta({ ref: "TaskNode" })
  export type Node = z.infer<typeof Node>

  export const Dependency = z
    .object({
      source_id: z.string(),
      target_id: z.string(),
    })
    .meta({ ref: "TaskDependency" })
  export type Dependency = z.infer<typeof Dependency>

  export const Info = z
    .object({
      nodes: Node.array(),
      dependencies: Dependency.array(),
    })
    .meta({ ref: "TaskGraph" })
  export type Info = z.infer<typeof Info>

  export function syncTodos(db: Database.TxOrDb, input: { sessionID: string; todos: TodoLike[] }) {
    const now = Date.now()
    db.delete(TaskNodeTable)
      .where(and(eq(TaskNodeTable.session_id, input.sessionID), eq(TaskNodeTable.type, "todo")))
      .run()

    if (input.todos.length === 0) return

    db.insert(TaskNodeTable)
      .values(
        input.todos.map((todo, position) => ({
          id: todoid(input.sessionID, position),
          session_id: input.sessionID,
          version: 1,
          type: "todo",
          content: todo.content,
          status: todo.status,
          priority: todo.priority,
          time_created: now,
          time_updated: now,
          data: {
            source: "todo",
            position,
          },
        })),
      )
      .run()

    const deps = input.todos
      .slice(1)
      .map((_, position) => ({
        source_id: todoid(input.sessionID, position),
        target_id: todoid(input.sessionID, position + 1),
      }))

    if (deps.length === 0) return

    db.insert(TaskDependencyTable).values(deps).run()
  }

  export function get(sessionID: string): Info {
    const nodes = Database.use((db) => db.select().from(TaskNodeTable).where(eq(TaskNodeTable.session_id, sessionID)).all())

    const ids = nodes.map((n) => n.id)
    const dependencies =
      ids.length === 0
        ? []
        : Database.use((db) =>
            db
              .select({ source_id: TaskDependencyTable.source_id, target_id: TaskDependencyTable.target_id })
              .from(TaskDependencyTable)
              .where(and(inArray(TaskDependencyTable.source_id, ids), inArray(TaskDependencyTable.target_id, ids)))
              .all(),
          )

    nodes.sort((a, b) => {
      const pa = pos(a.data)
      const pb = pos(b.data)
      if (pa !== pb) return pa - pb
      return a.time_created - b.time_created
    })

    return {
      nodes,
      dependencies,
    }
  }

  export function render(sessionID: string) {
    const graph = get(sessionID)
    const deps = new Map<string, string[]>()

    for (const dep of graph.dependencies) {
      const list = deps.get(dep.target_id)
      if (list) {
        list.push(dep.source_id)
        continue
      }
      deps.set(dep.target_id, [dep.source_id])
    }

    const lines = graph.nodes.map((node) => {
      const icon =
        node.status === "completed"
          ? "[x]"
          : node.status === "in_progress"
            ? "[>]"
            : node.status === "failed"
              ? "[!]"
              : node.status === "cancelled"
                ? "[-]"
                : "[ ]"

      const upstream = deps.get(node.id)
      if (!upstream?.length) return `${icon} (${node.priority}) ${node.content}`
      return `${icon} (${node.priority}) ${node.content}  <- ${upstream.join(", ")}`
    })

    return lines.join("\n")
  }
}
