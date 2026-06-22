import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Effect, Layer, Context } from "effect"
import z from "zod"
import { Database, eq, asc, and } from "../storage/db"
import { IssueTable } from "./issue.sql"

export namespace Issue {
  export const Status = z
    .enum(["backlog", "todo", "in_progress", "in_review", "done", "canceled"])
    .describe("Linear-aligned status: backlog, todo, in_progress, in_review, done, canceled")
  export type Status = z.infer<typeof Status>

  export const Priority = z
    .enum(["none", "urgent", "high", "medium", "low"])
    .describe("Linear-aligned priority: none, urgent, high, medium, low")
  export type Priority = z.infer<typeof Priority>

  export const Info = z
    .object({
      id: z.string().describe("Unique identifier for the issue"),
      directory: z.string().describe("Workspace directory this issue belongs to"),
      parent_id: z.string().nullable().describe("Parent issue ID for L1/L2 hierarchy; null for L1 root items"),
      level: z.number().int().min(0).describe("Hierarchy depth: 0=L1, 1=L2"),
      title: z.string().describe("Short label; falls back to content if empty"),
      content: z.string().describe("Brief description shown in list rows"),
      description: z
        .string()
        .default("")
        .describe("Rich-text markdown body with @file and /skill references (reuses the chat composer)"),
      status: Status.default("backlog"),
      priority: Priority.default("none"),
      labels: z.array(z.string()).default([]).describe("Tags for categorization"),
      due_date: z.string().nullable().optional().describe("Due date in ISO 8601 format"),
      assignee_id: z.string().nullable().optional().describe("Assignee user ID"),
      linear_issue_id: z.string().nullable().optional().describe("Linear issue ID for bidirectional sync"),
      linear_team_id: z.string().nullable().optional().describe("Linear team ID; set on pull"),
      linear_project_id: z.string().nullable().optional().describe("Linear project ID; set on pull"),
      position: z.number().int().describe("Sort order within the same parent level"),
      last_pushed_at: z.number().nullable().optional().describe("Unix ms of last successful push to Linear"),
      time_created: z.number().describe("Unix ms"),
      time_updated: z.number().describe("Unix ms"),
    })
    .meta({ ref: "Issue" })
  export type Info = z.infer<typeof Info>

  export const IssueNode = Info.extend({ children: Info.array() })
  export type IssueNode = z.infer<typeof IssueNode>

  export const Event = {
    Created: BusEvent.define(
      "issue.created",
      z.object({
        directory: z.string(),
        issue: Info,
      }),
    ),
    Updated: BusEvent.define(
      "issue.updated",
      z.object({
        directory: z.string(),
        issues: z.array(Info),
      }),
    ),
    Deleted: BusEvent.define(
      "issue.deleted",
      z.object({
        directory: z.string(),
        id: z.string(),
      }),
    ),
    Progressed: BusEvent.define(
      "issue.progressed",
      z.object({
        directory: z.string(),
        from: Status.nullable(),
        to: Status,
        reason: z.enum(["auto", "manual"]),
        id: z.string(),
      }),
    ),
  }

  export interface Interface {
    readonly get: (input: { directory: string }) => Effect.Effect<Info[]>
    readonly create: (input: { directory: string; issue: Partial<Info> }) => Effect.Effect<Info>
    readonly update: (input: { directory: string; id: string; patch: Partial<Info> }) => Effect.Effect<Info>
    readonly delete: (input: { directory: string; id: string }) => Effect.Effect<void>
    readonly patchStatus: (input: { directory: string; id: string; status: Status }) => Effect.Effect<Info>
    readonly patchAssignee: (input: { directory: string; id: string; assigneeId: string }) => Effect.Effect<Info>
    readonly reorder: (input: { directory: string; ids: string[] }) => Effect.Effect<void>
    readonly getTree: (input: { directory: string }) => Effect.Effect<IssueNode[]>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/Issue") {}

  const mapRow = (row: typeof IssueTable.$inferSelect): Info => ({
    id: row.id,
    directory: row.directory,
    parent_id: row.parent_id,
    level: row.level,
    title: row.title,
    content: row.content,
    description: row.description,
    status: row.status as Status,
    priority: row.priority as Priority,
    labels: JSON.parse(row.labels) as string[],
    due_date: row.due_date,
    assignee_id: row.assignee_id,
    linear_issue_id: row.linear_issue_id,
    linear_team_id: row.linear_team_id,
    linear_project_id: row.linear_project_id,
    position: row.position,
    last_pushed_at: row.last_pushed_at,
    time_created: row.time_created,
    time_updated: row.time_updated,
  })

  const toRow = (input: { directory: string; issue: Partial<Info>; position?: number }) => {
    const id = input.issue.id ?? crypto.randomUUID()
    const content = input.issue.content ?? ""
    return {
      id,
      directory: input.directory,
      parent_id: input.issue.parent_id ?? null,
      level: input.issue.level ?? 0,
      title: input.issue.title ?? content,
      content,
      description: input.issue.description ?? "",
      status: input.issue.status ?? ("backlog" as Status),
      priority: input.issue.priority ?? ("none" as Priority),
      labels: JSON.stringify(input.issue.labels ?? []),
      due_date: input.issue.due_date ?? null,
      assignee_id: input.issue.assignee_id ?? null,
      linear_issue_id: input.issue.linear_issue_id ?? null,
      linear_team_id: input.issue.linear_team_id ?? null,
      linear_project_id: input.issue.linear_project_id ?? null,
      position: input.position ?? 0,
      last_pushed_at: input.issue.last_pushed_at ?? null,
    }
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service

      const load = Effect.fn("Issue.load")(function* (directory: string) {
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .select()
              .from(IssueTable)
              .where(eq(IssueTable.directory, directory))
              .orderBy(asc(IssueTable.position))
              .all(),
          ),
        )
        return rows.map(mapRow)
      })

      const publish = Effect.fn("Issue.publish")(function* (directory: string) {
        const issues = yield* load(directory)
        yield* bus.publish(Event.Updated, { directory, issues })
        return issues
      })

      const get = Effect.fn("Issue.get")(function* (input: { directory: string }) {
        return yield* load(input.directory)
      })

      const create = Effect.fn("Issue.create")(function* (input: { directory: string; issue: Partial<Info> }) {
        const id = input.issue.id ?? crypto.randomUUID()
        const next = toRow({ directory: input.directory, issue: { ...input.issue, id } })
        yield* Effect.sync(() =>
          Database.use((db) => {
            const max = db
              .select({ pos: IssueTable.position })
              .from(IssueTable)
              .where(eq(IssueTable.directory, input.directory))
              .orderBy(asc(IssueTable.position))
              .all()
            const pos = max.length > 0 ? max[max.length - 1].pos + 1 : 0
            db.insert(IssueTable)
              .values({ ...next, position: pos })
              .run()
          }),
        )
        const issues = yield* publish(input.directory)
        const found = issues.find((i) => i.id === id)
        if (!found) return yield* Effect.die(new Error(`Issue not found after insert: ${id}`))
        yield* bus.publish(Event.Created, { directory: input.directory, issue: found })
        return found
      })

      const update = Effect.fn("Issue.update")(function* (input: {
        directory: string
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
            if (p.assignee_id !== undefined) set.assignee_id = p.assignee_id ?? null
            if (p.linear_issue_id !== undefined) set.linear_issue_id = p.linear_issue_id ?? null
            if (p.linear_team_id !== undefined) set.linear_team_id = p.linear_team_id ?? null
            if (p.linear_project_id !== undefined) set.linear_project_id = p.linear_project_id ?? null
            if (p.position !== undefined) set.position = p.position
            if (Object.keys(set).length === 0) return
            db.update(IssueTable)
              .set(set)
              .where(and(eq(IssueTable.directory, input.directory), eq(IssueTable.id, input.id)))
              .run()
          }),
        )
        const issues = yield* publish(input.directory)
        const found = issues.find((i) => i.id === input.id)
        if (!found) return yield* Effect.die(new Error(`Issue not found: ${input.id}`))
        if (input.patch.status !== undefined) {
          yield* bus.publish(Event.Progressed, {
            directory: input.directory,
            from: null,
            to: input.patch.status,
            reason: "manual",
            id: input.id,
          })
        }
        return found
      })

      const del = Effect.fn("Issue.delete")(function* (input: { directory: string; id: string }) {
        yield* Effect.sync(() =>
          Database.use((db) => {
            db.delete(IssueTable)
              .where(and(eq(IssueTable.directory, input.directory), eq(IssueTable.id, input.id)))
              .run()
          }),
        )
        yield* publish(input.directory)
        yield* bus.publish(Event.Deleted, { directory: input.directory, id: input.id })
      })

      const patchStatus = Effect.fn("Issue.patchStatus")(function* (input: {
        directory: string
        id: string
        status: Status
      }) {
        const before = (yield* load(input.directory)).find((i) => i.id === input.id)
        yield* Effect.sync(() =>
          Database.use((db) => {
            db.update(IssueTable)
              .set({ status: input.status })
              .where(and(eq(IssueTable.directory, input.directory), eq(IssueTable.id, input.id)))
              .run()
          }),
        )
        const issues = yield* publish(input.directory)
        const found = issues.find((i) => i.id === input.id)
        if (!found) return yield* Effect.die(new Error(`Issue not found: ${input.id}`))
        yield* bus.publish(Event.Progressed, {
          directory: input.directory,
          from: (before?.status ?? null) as Status | null,
          to: input.status,
          reason: "manual",
          id: input.id,
        })
        return found
      })

      const patchAssignee = Effect.fn("Issue.patchAssignee")(function* (input: {
        directory: string
        id: string
        assigneeId: string
      }) {
        yield* Effect.sync(() =>
          Database.use((db) => {
            db.update(IssueTable)
              .set({ assignee_id: input.assigneeId })
              .where(and(eq(IssueTable.directory, input.directory), eq(IssueTable.id, input.id)))
              .run()
          }),
        )
        const issues = yield* publish(input.directory)
        const found = issues.find((i) => i.id === input.id)
        if (!found) return yield* Effect.die(new Error(`Issue not found: ${input.id}`))
        return found
      })

      const reorder = Effect.fn("Issue.reorder")(function* (input: { directory: string; ids: string[] }) {
        yield* Effect.sync(() =>
          Database.transaction((db) => {
            for (const [index, id] of input.ids.entries()) {
              db.update(IssueTable)
                .set({ position: index })
                .where(and(eq(IssueTable.directory, input.directory), eq(IssueTable.id, id)))
                .run()
            }
          }),
        )
        yield* publish(input.directory)
      })

      const getTree = Effect.fn("Issue.getTree")(function* (input: { directory: string }) {
        const issues = yield* load(input.directory)
        const nodes: IssueNode[] = []
        for (const issue of issues) {
          if (issue.level === 0) {
            nodes.push({ ...issue, children: [] })
          } else if (issue.level === 1 && issue.parent_id) {
            const parent = nodes.find((n) => n.id === issue.parent_id)
            if (parent) parent.children.push(issue)
          }
        }
        return nodes
      })

      return Service.of({
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
