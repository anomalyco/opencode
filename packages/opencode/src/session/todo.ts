import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { SessionID } from "./schema"
import { Effect, Layer, Context } from "effect"
import z from "zod"
import { Database, eq, asc, and } from "../storage/db"
import { TodoTable } from "./session.sql"

export namespace Todo {
  export const Info = z
    .object({
      id: z.string().optional().describe("Unique identifier for the todo item"),
      parent_id: z.string().nullable().optional().describe("Parent todo ID for hierarchy; null for root-level items"),
      level: z.number().int().min(0).default(0).describe("Hierarchy depth: 0=root, 1=child, 2=grandchild"),
      title: z.string().optional().describe("Short label for the task; falls back to content if not set"),
      content: z.string().describe("Brief description of the task"),
      description: z.string().default("").describe("Detailed markdown description with @file and /skill references"),
      status: z.string().describe("Current status of the task: pending, in_progress, completed, cancelled"),
      priority: z.string().describe("Priority level of the task: high, medium, low"),
      labels: z.array(z.string()).default([]).describe("Tags/labels for categorization"),
      due_date: z.string().nullable().optional().describe("Due date in ISO 8601 format"),
      team_id: z.string().nullable().optional().describe("Team ID for issue sync"),
      project_id: z.string().nullable().optional().describe("Project ID for issue sync"),
      assignee_id: z.string().nullable().optional().describe("Assignee user ID for issue sync"),
      linear_issue_id: z.string().nullable().optional().describe("Linear issue ID for bidirectional sync"),
    })
    .meta({ ref: "Todo" })
  export type Info = z.infer<typeof Info>

  /** A todo node with nested L2 children */
  export type TodoNode = Info & { children: Info[] }

  export const Event = {
    Updated: BusEvent.define(
      "todo.updated",
      z.object({
        sessionID: SessionID.zod,
        todos: z.array(Info),
      }),
    ),
    Created: BusEvent.define(
      "todo.created",
      z.object({
        sessionID: SessionID.zod,
        todo: Info,
      }),
    ),
    Deleted: BusEvent.define(
      "todo.deleted",
      z.object({
        sessionID: SessionID.zod,
        id: z.string(),
      }),
    ),
    Progressed: BusEvent.define(
      "todo.progressed",
      z.object({
        sessionID: SessionID.zod,
        from: z.string().nullable(),
        to: z.string(),
        reason: z.enum(["auto", "manual"]),
      }),
    ),
  }

  export interface Interface {
    readonly replaceAll: (input: { sessionID: SessionID; todos: Info[] }) => Effect.Effect<void>
    readonly get: (sessionID: SessionID) => Effect.Effect<Info[]>
    /** Insert a single todo. Generates id via crypto.randomUUID() if missing. Returns the created todo. */
    readonly create: (input: { sessionID: SessionID; todo: Info }) => Effect.Effect<Info>
    /** Partially update a todo by id. Only provided fields in patch are applied. */
    readonly update: (input: { sessionID: SessionID; id: string; patch: Partial<Info> }) => Effect.Effect<Info>
    /** Delete a todo by id. */
    readonly delete: (input: { sessionID: SessionID; id: string }) => Effect.Effect<void>
    /** Update the status field of a todo. */
    readonly patchStatus: (input: { sessionID: SessionID; id: string; status: string }) => Effect.Effect<Info>
    /** Update the assignee_id field of a todo. */
    readonly patchAssignee: (input: { sessionID: SessionID; id: string; assigneeId: string }) => Effect.Effect<Info>
    /** Reorder todos by id list. Sets position to index in the array for each id. */
    readonly reorder: (input: { sessionID: SessionID; ids: string[] }) => Effect.Effect<void>
    /** Get hierarchical tree: L1 items with nested L2 children where parent_id matches L1 id. */
    readonly getTree: (sessionID: SessionID) => Effect.Effect<TodoNode[]>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/SessionTodo") {}

  /** Map a DB row to an Info object */
  const mapRow = (row: typeof TodoTable.$inferSelect): Info => ({
    id: row.id,
    parent_id: row.parent_id,
    level: row.level,
    title: row.title,
    content: row.content,
    description: row.description,
    status: row.status,
    priority: row.priority,
    labels: JSON.parse(row.labels) as string[],
    due_date: row.due_date,
    team_id: row.team_id,
    project_id: row.project_id,
    assignee_id: row.assignee_id,
    linear_issue_id: row.linear_issue_id,
  })

  /** Build a DB values object from an Info */
  const toRow = (input: { sessionID: SessionID; todo: Info; position?: number }) => ({
    session_id: input.sessionID,
    id: input.todo.id ?? crypto.randomUUID(),
    content: input.todo.content,
    status: input.todo.status,
    priority: input.todo.priority,
    position: input.position ?? 0,
    parent_id: input.todo.parent_id ?? null,
    level: input.todo.level,
    title: input.todo.title ?? input.todo.content,
    description: input.todo.description,
    labels: JSON.stringify(input.todo.labels),
    due_date: input.todo.due_date ?? null,
    team_id: input.todo.team_id ?? null,
    project_id: input.todo.project_id ?? null,
    assignee_id: input.todo.assignee_id ?? null,
    linear_issue_id: input.todo.linear_issue_id ?? null,
  })

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service

      const load = Effect.fn("Todo.load")(function* (sessionID: SessionID) {
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .select()
              .from(TodoTable)
              .where(eq(TodoTable.session_id, sessionID))
              .orderBy(asc(TodoTable.position))
              .all(),
          ),
        )
        return rows.map(mapRow)
      })

      const publish = Effect.fn("Todo.publish")(function* (sessionID: SessionID) {
        const todos = yield* load(sessionID)
        yield* bus.publish(Event.Updated, { sessionID, todos })
        return todos
      })

      const replaceAll = Effect.fn("Todo.replaceAll")(function* (input: { sessionID: SessionID; todos: Info[] }) {
        yield* Effect.sync(() =>
          Database.transaction((db) => {
            db.delete(TodoTable).where(eq(TodoTable.session_id, input.sessionID)).run()
            if (input.todos.length === 0) return
            db.insert(TodoTable)
              .values(input.todos.map((todo, index) => toRow({ sessionID: input.sessionID, todo, position: index })))
              .run()
          }),
        )
        yield* publish(input.sessionID)
      })

      const get = Effect.fn("Todo.get")(function* (sessionID: SessionID) {
        return yield* load(sessionID)
      })

      const create = Effect.fn("Todo.create")(function* (input: { sessionID: SessionID; todo: Info }) {
        const todo = { ...input.todo, id: input.todo.id ?? crypto.randomUUID() }
        yield* Effect.sync(() =>
          Database.use((db) => {
            const max = db
              .select({ pos: TodoTable.position })
              .from(TodoTable)
              .where(eq(TodoTable.session_id, input.sessionID))
              .orderBy(asc(TodoTable.position))
              .all()
            const pos = max.length > 0 ? max[max.length - 1].pos + 1 : 0
            db.insert(TodoTable).values(toRow({ sessionID: input.sessionID, todo, position: pos })).run()
          }),
        )
        const todos = yield* publish(input.sessionID)
        return todos.find((t) => t.id === todo.id) ?? todo
      })

      const update = Effect.fn("Todo.update")(function* (input: {
        sessionID: SessionID
        id: string
        patch: Partial<Info>
      }) {
        yield* Effect.sync(() =>
          Database.use((db) => {
            const set: Record<string, unknown> = {}
            const p = input.patch
            if (p.content !== undefined) set.content = p.content
            if (p.status !== undefined) set.status = p.status
            if (p.priority !== undefined) set.priority = p.priority
            if (p.parent_id !== undefined) set.parent_id = p.parent_id ?? null
            if (p.level !== undefined) set.level = p.level
            if (p.title !== undefined) set.title = p.title
            if (p.description !== undefined) set.description = p.description
            if (p.labels !== undefined) set.labels = JSON.stringify(p.labels)
            if (p.due_date !== undefined) set.due_date = p.due_date ?? null
            if (p.team_id !== undefined) set.team_id = p.team_id ?? null
            if (p.project_id !== undefined) set.project_id = p.project_id ?? null
            if (p.assignee_id !== undefined) set.assignee_id = p.assignee_id ?? null
            if (p.linear_issue_id !== undefined) set.linear_issue_id = p.linear_issue_id ?? null
            if (Object.keys(set).length === 0) return
            db.update(TodoTable)
              .set(set)
              .where(and(eq(TodoTable.session_id, input.sessionID), eq(TodoTable.id, input.id)))
              .run()
          }),
        )
        const todos = yield* publish(input.sessionID)
        const found = todos.find((t) => t.id === input.id)
        if (!found) return yield* Effect.die(new Error(`Todo not found: ${input.id}`))
        return found
      })

      const del = Effect.fn("Todo.delete")(function* (input: { sessionID: SessionID; id: string }) {
        yield* Effect.sync(() =>
          Database.use((db) => {
            db.delete(TodoTable)
              .where(and(eq(TodoTable.session_id, input.sessionID), eq(TodoTable.id, input.id)))
              .run()
          }),
        )
        yield* publish(input.sessionID)
      })

      const patchStatus = Effect.fn("Todo.patchStatus")(function* (input: {
        sessionID: SessionID
        id: string
        status: string
      }) {
        yield* Effect.sync(() =>
          Database.use((db) => {
            db.update(TodoTable)
              .set({ status: input.status })
              .where(and(eq(TodoTable.session_id, input.sessionID), eq(TodoTable.id, input.id)))
              .run()
          }),
        )
        const todos = yield* publish(input.sessionID)
        const found = todos.find((t) => t.id === input.id)
        if (!found) return yield* Effect.die(new Error(`Todo not found: ${input.id}`))
        return found
      })

      const patchAssignee = Effect.fn("Todo.patchAssignee")(function* (input: {
        sessionID: SessionID
        id: string
        assigneeId: string
      }) {
        yield* Effect.sync(() =>
          Database.use((db) => {
            db.update(TodoTable)
              .set({ assignee_id: input.assigneeId })
              .where(and(eq(TodoTable.session_id, input.sessionID), eq(TodoTable.id, input.id)))
              .run()
          }),
        )
        const todos = yield* publish(input.sessionID)
        const found = todos.find((t) => t.id === input.id)
        if (!found) return yield* Effect.die(new Error(`Todo not found: ${input.id}`))
        return found
      })

      const reorder = Effect.fn("Todo.reorder")(function* (input: { sessionID: SessionID; ids: string[] }) {
        yield* Effect.sync(() =>
          Database.transaction((db) => {
            for (const [index, id] of input.ids.entries()) {
              db.update(TodoTable)
                .set({ position: index })
                .where(and(eq(TodoTable.session_id, input.sessionID), eq(TodoTable.id, id)))
                .run()
            }
          }),
        )
        yield* publish(input.sessionID)
      })

      const getTree = Effect.fn("Todo.getTree")(function* (sessionID: SessionID) {
        const todos = yield* load(sessionID)
        const nodes: TodoNode[] = []
        for (const todo of todos) {
          if (todo.level === 0) {
            nodes.push({ ...todo, children: [] })
          } else if (todo.level === 1 && todo.parent_id) {
            const parent = nodes.find((n) => n.id === todo.parent_id)
            if (parent) parent.children.push(todo)
          }
        }
        return nodes
      })

      return Service.of({
        replaceAll,
        get,
        create,
        update,
        delete: del,
        patchStatus,
        patchAssignee,
        reorder,
        getTree,
      })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))
}
