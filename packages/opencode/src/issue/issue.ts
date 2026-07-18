import { Effect, Layer, Context, Schema, Option } from "effect"
import z from "zod"
import { define, inventory } from "@opencode-ai/schema/event"
import { EventV2Bridge } from "@/event-v2-bridge"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { eq, asc, and, isNull } from "drizzle-orm"
import { IssueTable } from "./issue.sql"

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

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
    last_pulled_at: z
      .number()
      .nullable()
      .optional()
      .describe("Mirror of Linear cloud-side updatedAt (Unix ms); watermark for pull reconcile (ADR-0002 D5 revised)"),
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
export const Event = {
  Created,
  Updated,
  Deleted,
  Definitions: inventory(Created, Updated, Deleted),
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
  const v = Option.getOrUndefined(decodeJson(raw))
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
  labels: Option.getOrUndefined(decodeJson(row.labels)) as string[],
  due_date: row.due_date,
  assignee_id: row.assignee_id,
  linear_issue_id: row.linear_issue_id,
  linear_team_id: row.linear_team_id,
  linear_project_id: row.linear_project_id,
  position: row.position,
  last_pushed_at: row.last_pushed_at,
  last_pulled_at: row.last_pulled_at,
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
    last_pulled_at: input.issue.last_pulled_at ?? null,
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
      const level = input.issue.level ?? 0
      const parentId = input.issue.parent_id ?? null

      // Hierarchy validation: only two levels (0=L1, 1=L2) are allowed.
      if (level > 1) return yield* Effect.die(new Error(`Issue level exceeds max depth (1): ${level}`))
      // L1 (level 0) must not carry a parent_id.
      if (level === 0 && parentId !== null) {
        return yield* Effect.die(new Error("L1 issue cannot have a parent_id"))
      }
      // L2 (level 1) must reference an existing L1 issue in the same directory.
      if (level === 1) {
        if (!parentId) return yield* Effect.die(new Error("L2 issue requires a parent_id"))
        const parent = yield* db
          .select({ level: IssueTable.level })
          .from(IssueTable)
          .where(and(eq(IssueTable.directory, input.directory), eq(IssueTable.id, parentId)))
          .all()
          .pipe(Effect.orDie)
        if (parent.length === 0) return yield* Effect.die(new Error(`Parent issue not found: ${parentId}`))
        if (parent[0].level !== 0) return yield* Effect.die(new Error("Parent must be an L1 issue (level 0)"))
      }

      const next = toRow({ directory: input.directory, issue: { ...input.issue, id, level, parent_id: parentId } })
      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            // Position is scoped to the same parent (null for L1, parent_id for L2).
            const parentFilter = parentId === null ? isNull(IssueTable.parent_id) : eq(IssueTable.parent_id, parentId)
            const max = yield* tx
              .select({ pos: IssueTable.position })
              .from(IssueTable)
              .where(and(eq(IssueTable.directory, input.directory), parentFilter))
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
      if (p.last_pulled_at !== undefined) set.last_pulled_at = p.last_pulled_at ?? null
      if (p.cloud_shadow !== undefined)
        set.cloud_shadow = p.cloud_shadow != null ? JSON.stringify(p.cloud_shadow) : null
      if (p.time_updated !== undefined) set.time_updated = p.time_updated

      // Auto-bump `time_updated` when any content field changes, unless the
      // caller explicitly provided `time_updated`. `time_updated` records the
      // local edit time and is the local-side dirty marker used by push to
      // decide whether a row needs to be sent to Linear (`time_updated >
      // last_pushed_at`). It is distinct from `last_pulled_at` (Linear
      // sync watermark used by pull) and `last_pushed_at` (last push time).
      // Linkage metadata (linear_*_id), sync timestamps
      // (last_pushed_at / last_pulled_at), and the cloud_shadow snapshot
      // are intentionally excluded — they are not user-meaningful content
      // edits and must not signal local dirtiness.
      if (p.time_updated === undefined) {
        const contentChanged =
          p.title !== undefined ||
          p.content !== undefined ||
          p.description !== undefined ||
          p.status !== undefined ||
          p.priority !== undefined ||
          p.labels !== undefined ||
          p.due_date !== undefined ||
          p.assignee_id !== undefined ||
          p.parent_id !== undefined ||
          p.level !== undefined ||
          p.position !== undefined
        if (contentChanged) set.time_updated = Date.now()
      }

      // Hierarchy consistency validation when parent_id or level is patched.
      if (p.parent_id !== undefined || p.level !== undefined) {
        const current = (yield* load(input.directory)).find((i) => i.id === input.id)
        if (!current) return yield* Effect.die(new Error(`Issue not found: ${input.id}`))
        const finalLevel = p.level !== undefined ? p.level : current.level
        const finalParentId = p.parent_id !== undefined ? (p.parent_id ?? null) : current.parent_id
        if (finalLevel > 1) return yield* Effect.die(new Error(`Issue level exceeds max depth (1): ${finalLevel}`))
        if (finalParentId === input.id) return yield* Effect.die(new Error("Issue cannot be its own parent"))
        if (finalLevel === 0 && finalParentId !== null) {
          return yield* Effect.die(new Error("L1 issue cannot have a parent_id"))
        }
        if (finalLevel === 1) {
          if (!finalParentId) return yield* Effect.die(new Error("L2 issue requires a parent_id"))
          const parent = yield* db
            .select({ level: IssueTable.level })
            .from(IssueTable)
            .where(and(eq(IssueTable.directory, input.directory), eq(IssueTable.id, finalParentId)))
            .all()
            .pipe(Effect.orDie)
          if (parent.length === 0) return yield* Effect.die(new Error(`Parent issue not found: ${finalParentId}`))
          if (parent[0].level !== 0) return yield* Effect.die(new Error("Parent must be an L1 issue (level 0)"))
        }
      }

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
      return found
    })

    const del = Effect.fn("Issue.delete")(function* (input: { directory: string; id: string }) {
      // Cascade delete: remove all L2 children whose parent_id points to this issue,
      // then delete the issue itself.
      yield* db
        .delete(IssueTable)
        .where(and(eq(IssueTable.directory, input.directory), eq(IssueTable.parent_id, input.id)))
        .run()
        .pipe(Effect.orDie)
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
      yield* db
        .update(IssueTable)
        .set({ status: input.status, time_updated: Date.now() })
        .where(and(eq(IssueTable.directory, input.directory), eq(IssueTable.id, input.id)))
        .run()
        .pipe(Effect.orDie)
      const issues = yield* publish(input.directory)
      const found = issues.find((i) => i.id === input.id)
      if (!found) return yield* Effect.die(new Error(`Issue not found: ${input.id}`))
      return found
    })

    const reorder = Effect.fn("Issue.reorder")(function* (input: { directory: string; ids: string[] }) {
      // Position is scoped per parent: L1 items share the null-parent scope,
      // L2 items share their parent's scope. We group ids by parent_id and
      // assign sequential positions within each group, so reordering L1 does
      // not clobber L2 positions and vice versa.
      const all = yield* load(input.directory)
      const idToParent = new Map<string, string | null>()
      for (const i of all) idToParent.set(i.id, i.parent_id)

      const byParent = new Map<string | null, string[]>()
      for (const id of input.ids) {
        const parent = idToParent.get(id) ?? null
        const list = byParent.get(parent) ?? []
        list.push(id)
        byParent.set(parent, list)
      }

      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* Effect.forEach(
              byParent,
              ([parent, ids]) =>
                Effect.forEach(
                  ids,
                  (id, index) =>
                    tx
                      .update(IssueTable)
                      .set({ position: index })
                      .where(and(eq(IssueTable.directory, input.directory), eq(IssueTable.id, id)))
                      .run()
                      .pipe(Effect.orDie),
                  { discard: true },
                ),
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

export * as Issue from "./issue"
