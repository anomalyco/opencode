import { Effect, Layer, Context, Schema } from "effect"
import z from "zod"
import { define, inventory } from "@opencode-ai/schema/event"
import { EventV2Bridge } from "@/event-v2-bridge"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { eq, asc, and } from "drizzle-orm"
import { IssueTable } from "./issue.sql"

export namespace Issue {
  /**
   * Linear workflow state name as returned by `list_issues` (the `status`
   * field on each issue node). Stored verbatim — no mapping, no enum.
   * Standard Linear defaults: "Backlog", "Todo", "In Progress", "In Review",
   * "Done", "Canceled", "Duplicate". Teams may customize these names, so
   * this is a plain string, not a fixed enum. The frontend fetches the
   * available states per-team via `list_issue_statuses` MCP tool and renders
   * a dynamic selector.
   */
  export const Status = z
    .string()
    .describe(
      "Linear workflow state name (e.g., 'Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Canceled', 'Duplicate')",
    )
  export type Status = z.infer<typeof Status>

  /** Default status for newly created issues — does not trigger AutoProgress. */
  export const DEFAULT_STATUS = "Backlog"

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
      status: Status.default(DEFAULT_STATUS),
      priority: Priority.default("none"),
      labels: z.array(z.string()).default([]).describe("Tags for categorization"),
      due_date: z.string().nullable().optional().describe("Due date in ISO 8601 format"),
      assignee_id: z.string().nullable().optional().describe("Assignee user ID"),
      linear_issue_id: z.string().nullable().optional().describe("Linear issue ID for bidirectional sync"),
      linear_team_id: z.string().nullable().optional().describe("Linear team ID; set on pull"),
      linear_project_id: z.string().nullable().optional().describe("Linear project ID; set on pull"),
      position: z.number().int().describe("Sort order within the same parent level"),
      last_pushed_at: z.number().nullable().optional().describe("Unix ms of last successful push to Linear"),
      linear_updated_at: z
        .number()
        .nullable()
        .optional()
        .describe(
          "Mirror of Linear cloud-side updatedAt (Unix ms); watermark for pull reconcile (ADR-0002 D5 revised)",
        ),
      cloud_shadow: z
        .record(z.string(), z.unknown())
        .nullable()
        .optional()
        .describe(
          "JSON snapshot of Linear-sourced content fields at last sync; used for field-level merge on single-issue push",
        ),
      time_created: z.number().describe("Unix ms"),
      time_updated: z.number().describe("Unix ms"),
    })
    .meta({ ref: "Issue" })
  export type Info = z.infer<typeof Info>

  export const IssueNode = Info.extend({ children: Info.array() })
  export type IssueNode = z.infer<typeof IssueNode>

  const Created = define({
    type: "issue.created",
    schema: {
      directory: Schema.String,
      issue: Schema.Unknown,
    },
  })
  const Updated = define({
    type: "issue.updated",
    schema: {
      directory: Schema.String,
      issues: Schema.Array(Schema.Unknown),
    },
  })
  const Deleted = define({
    type: "issue.deleted",
    schema: {
      directory: Schema.String,
      id: Schema.String,
    },
  })
  const Progressed = define({
    type: "issue.progressed",
    schema: {
      directory: Schema.String,
      from: Schema.NullOr(Schema.String),
      to: Schema.String,
      reason: Schema.Literals(["auto", "manual"]),
      id: Schema.String,
    },
  })
  export const Event = {
    Created,
    Updated,
    Deleted,
    Progressed,
    Definitions: inventory(Created, Updated, Deleted, Progressed),
  }

  export interface Interface {
    readonly get: (input: { directory: string }) => Effect.Effect<Info[]>
    readonly create: (input: { directory: string; issue: Partial<Info> }) => Effect.Effect<Info>
    readonly update: (input: { directory: string; id: string; patch: Partial<Info> }) => Effect.Effect<Info>
    readonly delete: (input: { directory: string; id: string }) => Effect.Effect<void>
    readonly patchStatus: (input: { directory: string; id: string; status: Status }) => Effect.Effect<Info>
    readonly reorder: (input: { directory: string; ids: string[] }) => Effect.Effect<void>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/Issue") {}

  /**
   * The set of Linear-sourced content fields tracked in `cloud_shadow`.
   * These are the fields that flow between local and Linear; system fields
   * (id, directory, parent_id, level, position, timestamps, link IDs) are
   * never part of the shadow.
   */
  export const SHADOW_FIELDS = [
    "title",
    "content",
    "description",
    "status",
    "priority",
    "labels",
    "due_date",
    "assignee_id",
  ] as const
  export type ShadowField = (typeof SHADOW_FIELDS)[number]

  /** Build a cloud_shadow snapshot from an Issue.Info (current local state). */
  export const buildShadow = (i: Info): Record<string, unknown> => {
    const s: Record<string, unknown> = {}
    for (const f of SHADOW_FIELDS) s[f] = i[f]
    return s
  }

  /** Parse the `cloud_shadow` DB column (JSON string) into a record, or null. */
  const cloudShadowFromRow = (raw: string | null): Record<string, unknown> | null | undefined => {
    if (raw == null) return null
    const v = JSON.parse(raw) as unknown
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  }

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
    linear_updated_at: row.linear_updated_at,
    cloud_shadow: cloudShadowFromRow(row.cloud_shadow),
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
      status: input.issue.status ?? (DEFAULT_STATUS as Status),
      priority: input.issue.priority ?? ("none" as Priority),
      labels: JSON.stringify(input.issue.labels ?? []),
      due_date: input.issue.due_date ?? null,
      assignee_id: input.issue.assignee_id ?? null,
      linear_issue_id: input.issue.linear_issue_id ?? null,
      linear_team_id: input.issue.linear_team_id ?? null,
      linear_project_id: input.issue.linear_project_id ?? null,
      position: input.position ?? 0,
      last_pushed_at: input.issue.last_pushed_at ?? null,
      linear_updated_at: input.issue.linear_updated_at ?? null,
      cloud_shadow: input.issue.cloud_shadow != null ? JSON.stringify(input.issue.cloud_shadow) : null,
    }
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const events = yield* EventV2Bridge.Service
      const { db } = yield* Database.Service

      const load = Effect.fn("Issue.load")(function* (directory: string) {
        const rows = yield* db
          .select()
          .from(IssueTable)
          .where(eq(IssueTable.directory, directory))
          .orderBy(asc(IssueTable.position))
          .all()
          .pipe(Effect.orDie)
        return rows.map(mapRow)
      })

      const publish = Effect.fn("Issue.publish")(function* (directory: string) {
        const issues = yield* load(directory)
        yield* events.publish(Event.Updated, { directory, issues })
        return issues
      })

      const get = Effect.fn("Issue.get")(function* (input: { directory: string }) {
        return yield* load(input.directory)
      })

      const create = Effect.fn("Issue.create")(function* (input: { directory: string; issue: Partial<Info> }) {
        const id = input.issue.id ?? crypto.randomUUID()
        const next = toRow({ directory: input.directory, issue: { ...input.issue, id } })
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const max = yield* tx
                .select({ pos: IssueTable.position })
                .from(IssueTable)
                .where(eq(IssueTable.directory, input.directory))
                .orderBy(asc(IssueTable.position))
                .all()
                .pipe(Effect.orDie)
              const pos = max.length > 0 ? max[max.length - 1].pos! + 1 : 0
              yield* tx
                .insert(IssueTable)
                .values({ ...next, position: pos })
                .run()
                .pipe(Effect.orDie)
            }),
          )
          .pipe(Effect.orDie)
        const issues = yield* publish(input.directory)
        const found = issues.find((i) => i.id === id)
        if (!found) return yield* Effect.die(new Error(`Issue not found after insert: ${id}`))
        yield* events.publish(Event.Created, { directory: input.directory, issue: found })
        return found
      })

      const update = Effect.fn("Issue.update")(function* (input: {
        directory: string
        id: string
        patch: Partial<Info>
      }) {
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
        if (p.last_pushed_at !== undefined) set.last_pushed_at = p.last_pushed_at ?? null
        if (p.linear_updated_at !== undefined) set.linear_updated_at = p.linear_updated_at ?? null
        if (p.cloud_shadow !== undefined)
          set.cloud_shadow = p.cloud_shadow != null ? JSON.stringify(p.cloud_shadow) : null
        if (p.time_updated !== undefined) set.time_updated = p.time_updated
        if (Object.keys(set).length > 0) {
          yield* db
            .update(IssueTable)
            .set(set)
            .where(and(eq(IssueTable.directory, input.directory), eq(IssueTable.id, input.id)))
            .run()
            .pipe(Effect.orDie)
        }
        const issues = yield* publish(input.directory)
        const found = issues.find((i) => i.id === input.id)
        if (!found) return yield* Effect.die(new Error(`Issue not found: ${input.id}`))
        if (input.patch.status !== undefined) {
          yield* events.publish(Event.Progressed, {
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
        yield* db
          .delete(IssueTable)
          .where(and(eq(IssueTable.directory, input.directory), eq(IssueTable.id, input.id)))
          .run()
          .pipe(Effect.orDie)
        yield* publish(input.directory)
        yield* events.publish(Event.Deleted, { directory: input.directory, id: input.id })
      })

      const patchStatus = Effect.fn("Issue.patchStatus")(function* (input: {
        directory: string
        id: string
        status: Status
      }) {
        const before = (yield* load(input.directory)).find((i) => i.id === input.id)
        yield* db
          .update(IssueTable)
          .set({ status: input.status })
          .where(and(eq(IssueTable.directory, input.directory), eq(IssueTable.id, input.id)))
          .run()
          .pipe(Effect.orDie)
        const issues = yield* publish(input.directory)
        const found = issues.find((i) => i.id === input.id)
        if (!found) return yield* Effect.die(new Error(`Issue not found: ${input.id}`))
        yield* events.publish(Event.Progressed, {
          directory: input.directory,
          from: (before?.status ?? null) as Status | null,
          to: input.status,
          reason: "manual",
          id: input.id,
        })
        return found
      })

      const reorder = Effect.fn("Issue.reorder")(function* (input: { directory: string; ids: string[] }) {
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* Effect.forEach(
                input.ids,
                (id, index) =>
                  tx
                    .update(IssueTable)
                    .set({ position: index })
                    .where(and(eq(IssueTable.directory, input.directory), eq(IssueTable.id, id)))
                    .run()
                    .pipe(Effect.orDie),
                { discard: true },
              )
            }),
          )
          .pipe(Effect.orDie)
        yield* publish(input.directory)
      })

      return Service.of({
        get,
        create,
        update,
        delete: del,
        patchStatus,
        reorder,
      })
    }),
  )

  export const node = LayerNode.make({ service: Service, layer: layer, deps: [EventV2Bridge.node, Database.node] })
}
