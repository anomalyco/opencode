import { Effect, Layer, Context, Schema, Option } from "effect"
import { define, inventory } from "@opencode-ai/schema/event"
import { EventV2Bridge } from "@/event-v2-bridge"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { NonNegativeInt } from "@opencode-ai/core/schema"
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
export const Status = Schema.String.annotate({
  description:
    "Linear workflow state name (e.g., 'Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Canceled', 'Duplicate')",
})
export type Status = Schema.Schema.Type<typeof Status>

/** Default status for newly created issues — classified as Active (Backlog). */
export const DEFAULT_STATUS = "Backlog"

/**
 * Status classification (per spec §3.1). Active issues are editable and
 * returned by `issue_list` by default; Archived issues are read-only and
 * excluded from the default list view.
 */
export const ARCHIVED_STATUSES = new Set<Status>(["Done", "Canceled", "Duplicate"])
export const ACTIVE_STATUSES = new Set<Status>(["Backlog", "Todo", "In Progress", "In Review"])

export const isArchived = (status: Status): boolean => ARCHIVED_STATUSES.has(status)

/** Terminal outcome for `archive`. Maps 1:1 to an Archived status. */
export const Outcome = Schema.Literals(["done", "canceled", "duplicate"])
export type Outcome = Schema.Schema.Type<typeof Outcome>
export const OUTCOME_TO_STATUS: Record<Outcome, Status> = {
  done: "Done",
  canceled: "Canceled",
  duplicate: "Duplicate",
}

/** Error: attempted to delete an Active issue (spec §5.4). */
export class IssueNotArchivedError extends Schema.TaggedErrorClass<IssueNotArchivedError>()("Issue.NotArchivedError", {
  id: Schema.String,
}) {}

/** Error: issue (or parent issue) referenced by id was not found in the workspace. */
export class IssueNotFoundError extends Schema.TaggedErrorClass<IssueNotFoundError>()("Issue.NotFoundError", {
  id: Schema.String,
  context: Schema.optional(Schema.String).annotate({
    description: "Where the lookup failed (e.g., 'after insert', 'before archive')",
  }),
}) {}

/** Error: L1/L2 hierarchy constraint violated (level/parent validation). */
export class IssueHierarchyError extends Schema.TaggedErrorClass<IssueHierarchyError>()("Issue.HierarchyError", {
  reason: Schema.String.annotate({
    description:
      "Machine-readable reason: max_depth | l1_with_parent | l2_without_parent | parent_not_found | parent_not_l1 | self_parent",
  }),
  detail: Schema.optional(Schema.String).annotate({
    description: "Human-readable detail (e.g., the offending id or level value)",
  }),
}) {}

/**
 * Domain-level Error union for the Issue service (per AGENTS.md [E9] —
 * "Export a domain-level `Error` union from each service module"). All
 * expected failures from `Issue.Service` methods are tagged errors; DB
 * errors are die'd via `Effect.orDie` and propagate as defects.
 */
export type Error = IssueNotArchivedError | IssueNotFoundError | IssueHierarchyError

export const Priority = Schema.Literals(["none", "urgent", "high", "medium", "low"]).annotate({
  description: "Linear-aligned priority: none, urgent, high, medium, low",
})
export type Priority = Schema.Schema.Type<typeof Priority>

/**
 * Issue record (workspace-scoped todo). Field defaults (description="",
 * status=DEFAULT_STATUS, priority="none", labels=[]) are applied in
 * `toRow` / `mapRow` at the DB boundary, not at the schema level.
 */
export const Info = Schema.Struct({
  id: Schema.String.annotate({ description: "Unique identifier for the issue" }),
  directory: Schema.String.annotate({ description: "Workspace directory this issue belongs to" }),
  parent_id: Schema.NullOr(Schema.String).annotate({
    description: "Parent issue ID for L1/L2 hierarchy; null for L1 root items",
  }),
  level: NonNegativeInt.annotate({ description: "Hierarchy depth: 0=L1, 1=L2" }),
  title: Schema.String.annotate({ description: "Short label; falls back to content if empty" }),
  content: Schema.String.annotate({ description: "Brief description shown in list rows" }),
  description: Schema.String.annotate({
    description: "Rich-text markdown body with @file and /skill references (reuses the chat composer)",
  }),
  status: Status,
  priority: Priority,
  labels: Schema.Array(Schema.String).annotate({ description: "Tags for categorization" }),
  due_date: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description: "Due date in ISO 8601 format",
  }),
  assignee_id: Schema.optional(Schema.NullOr(Schema.String)).annotate({ description: "Assignee user ID" }),
  linear_issue_id: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description: "Linear issue ID for bidirectional sync",
  }),
  linear_team_id: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description: "Linear team ID; set on pull",
  }),
  linear_project_id: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description: "Linear project ID; set on pull",
  }),
  position: NonNegativeInt.annotate({ description: "Sort order within the same parent level" }),
  last_pushed_at: Schema.optional(Schema.NullOr(Schema.Number)).annotate({
    description: "Unix ms of last successful push to Linear",
  }),
  last_pulled_at: Schema.optional(Schema.NullOr(Schema.Number)).annotate({
    description: "Mirror of Linear cloud-side updatedAt (Unix ms); watermark for pull reconcile (ADR-0002 D5 revised)",
  }),
  cloud_shadow: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))).annotate({
    description:
      "JSON snapshot of Linear-sourced content fields at last sync; used for field-level merge on single-issue push",
  }),
  time_created: Schema.Number.annotate({ description: "Unix ms" }),
  time_updated: Schema.Number.annotate({ description: "Unix ms" }),
}).annotate({ identifier: "Issue" })
export type Info = Schema.Schema.Type<typeof Info>

export const IssueNode = Schema.Struct({
  ...Info.fields,
  children: Schema.Array(Info),
}).annotate({ identifier: "IssueNode" })
export type IssueNode = Schema.Schema.Type<typeof IssueNode>

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
  readonly get: (input: { directory: string; include_archived?: boolean }) => Effect.Effect<Info[]>
  readonly create: (input: {
    directory: string
    issue: Partial<Info>
  }) => Effect.Effect<Info, IssueNotFoundError | IssueHierarchyError>
  readonly update: (input: {
    directory: string
    id: string
    patch: Partial<Info>
  }) => Effect.Effect<Info, IssueNotFoundError | IssueHierarchyError>
  readonly delete: (input: {
    directory: string
    id: string
  }) => Effect.Effect<void, IssueNotArchivedError | IssueNotFoundError>
  readonly reorder: (input: { directory: string; ids: string[] }) => Effect.Effect<void>
  readonly archive: (input: {
    directory: string
    id: string
    outcome: Outcome
  }) => Effect.Effect<Info, IssueNotFoundError>
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
  return Object.fromEntries(SHADOW_FIELDS.map((f) => [f, i[f]]))
}

/** Parse the `cloud_shadow` DB column (JSON string) into a record, or null. */
const cloudShadowFromRow = (raw: string | null): Record<string, unknown> | null | undefined => {
  if (raw == null) return null
  const v = Option.getOrUndefined(decodeJson(raw))
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

const decodePriority = Schema.decodeUnknownOption(Priority)

/**
 * Decode a `priority` DB value into the typed `Priority` union. Falls back
 * to `"none"` for unknown values — the DB column is `text()` so Drizzle
 * types it as `string`, but app logic only ever writes valid union members.
 * The fallback is defensive: if a future migration or external write
 * introduces an invalid value, we degrade to "no priority" rather than
 * corrupting the typed channel or failing the read.
 */
const priorityFromDb = (raw: string): Priority =>
  Option.getOrElse(decodePriority(raw), () => "none")

const mapRow = (row: typeof IssueTable.$inferSelect): Info => ({
  id: row.id,
  directory: row.directory,
  parent_id: row.parent_id,
  level: row.level,
  title: row.title,
  content: row.content,
  description: row.description,
  // `Status = Schema.String` — DB `text()` column is already `string`, so
  // no assertion is needed. Linear stores status verbatim (per ADR-0002 D6)
  // and we do not validate the value against a fixed enum at the DB boundary
  // because Linear teams may customize workflow state names.
  status: row.status,
  // `Priority` is a string literal union ("none" | "urgent" | "high" |
  // "medium" | "low"). The DB column only stores these values (enforced by
  // app logic at write time), but TS can't prove that from the Drizzle
  // `text()` type. Decode through the Schema so invalid values fall back
  // to "none" rather than corrupting the typed channel.
  priority: priorityFromDb(row.priority),
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

/**
 * Project an `Issue.Info` into the agent-facing representation (ADR-0005 D6).
 *
 * Sync-internal bookkeeping fields (`last_pushed_at`, `last_pulled_at`,
 * `cloud_shadow`) are stripped — they are not actionable for the agent and
 * their presence creates confusion. `linear_issue_id` / `linear_team_id` /
 * `linear_project_id` are kept because the agent needs them to route edits
 * to the correct remote path (Linear MCP `save_issue` or `linear_graphql`).
 *
 * The full `Info` (with all fields) is still returned by `Issue.Service.get`
 * for UI consumers that need the sync metadata. The filtering happens only
 * at the agent tool boundary.
 */
export const toAgentInfo = (i: Info): Omit<Info, "last_pushed_at" | "last_pulled_at" | "cloud_shadow"> => {
  return {
    id: i.id,
    directory: i.directory,
    parent_id: i.parent_id,
    level: i.level,
    title: i.title,
    content: i.content,
    description: i.description,
    status: i.status,
    priority: i.priority,
    labels: i.labels,
    due_date: i.due_date,
    assignee_id: i.assignee_id,
    linear_issue_id: i.linear_issue_id,
    linear_team_id: i.linear_team_id,
    linear_project_id: i.linear_project_id,
    position: i.position,
    time_created: i.time_created,
    time_updated: i.time_updated,
  }
}

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
    const database = yield* Database.Service
    const db = database.db

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

    /**
     * Filter issues by Active/Archived classification (spec §3.1, §5.1).
     * Default (include_archived=false): return non-archived L1 + their
     * non-archived L2; archived L1 hides its entire subtree.
     * include_archived=true: return everything.
     */
    const filterByArchive = (all: Info[], includeArchived: boolean): Info[] => {
      if (includeArchived) return all
      const activeL1Ids = new Set(all.filter((i) => i.level === 0 && !isArchived(i.status)).map((i) => i.id))
      return all.filter((i) => {
        if (i.level === 0) return activeL1Ids.has(i.id)
        return i.parent_id !== null && activeL1Ids.has(i.parent_id) && !isArchived(i.status)
      })
    }

    const publish = Effect.fn("Issue.publish")(function* (directory: string) {
      const issues = yield* load(directory)
      yield* events.publish(Event.Updated, { directory, issues })
      return issues
    })

    const get = Effect.fn("Issue.get")(function* (input: { directory: string; include_archived?: boolean }) {
      const all = yield* load(input.directory)
      return filterByArchive(all, input.include_archived ?? false)
    })

    const create = Effect.fn("Issue.create")(function* (input: { directory: string; issue: Partial<Info> }) {
      const id = input.issue.id ?? crypto.randomUUID()
      const level = input.issue.level ?? 0
      const parentId = input.issue.parent_id ?? null

      // Hierarchy validation: only two levels (0=L1, 1=L2) are allowed.
      if (level > 1) return yield* new IssueHierarchyError({ reason: "max_depth", detail: `${level}` })
      // L1 (level 0) must not carry a parent_id.
      if (level === 0 && parentId !== null) {
        return yield* new IssueHierarchyError({ reason: "l1_with_parent" })
      }
      // L2 (level 1) must reference an existing L1 issue in the same directory.
      if (level === 1) {
        if (!parentId) return yield* new IssueHierarchyError({ reason: "l2_without_parent" })
        const parent = yield* db
          .select({ level: IssueTable.level })
          .from(IssueTable)
          .where(and(eq(IssueTable.directory, input.directory), eq(IssueTable.id, parentId)))
          .all()
          .pipe(Effect.orDie)
        if (parent.length === 0) return yield* new IssueHierarchyError({ reason: "parent_not_found", detail: parentId })
        if (parent[0].level !== 0) return yield* new IssueHierarchyError({ reason: "parent_not_l1" })
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
            // `pos` is NonNegativeInt so it's typed as `number`. Drizzle
            // returns it as `number | null` in select projections even though
            // the column is NOT NULL — use Option to handle the TS-side null
            // without a non-null assertion.
            const lastPos = max.length > 0 ? max[max.length - 1].pos : undefined
            const pos = lastPos !== undefined ? lastPos + 1 : 0
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
      if (!found) return yield* new IssueNotFoundError({ id, context: "after insert" })
      yield* events.publish(Event.Created, { directory: input.directory, issue: found })
      return found
    })

    const update = Effect.fn("Issue.update")(function* (input: {
      directory: string
      id: string
      patch: Partial<Info>
    }) {
      // Archived issues are user-disabled in the UI but remain manageable
      // by both users and agents (per ADR-0001 Amendment 2026-07-19 §D17:
      // "归档语义仅为该待办已经处理完成...但是拉取和推送还是需要考虑
      // 这些 Issue"). The previous `IssueArchivedError` guard here
      // conflated UI-level disablement with permission-level block, which
      // prevented agents from updating Done/Canceled/Duplicate issues
      // (e.g., cloud-wins reconcile on pull, status cycle on UI).
      // The guard is removed; the UI disables interactions on archived
      // rows via `isArchived(issue)` checks in sidebar-todo.tsx instead.
      const current = (yield* load(input.directory)).find((i) => i.id === input.id)
      if (!current) return yield* new IssueNotFoundError({ id: input.id, context: "before update" })

      // ADR-0005 D2: Linear-linked refusal is enforced at the agent tool
      // layer (issue_update.ts), NOT here. The HTTP API (UI path) must be
      // able to edit Linear-linked issues locally — the user edits in the
      // sidebar, then pushes to Linear via SyncPush. Sync services bypass
      // the service layer entirely (direct DB writes), so they are
      // unaffected either way.

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
      // `linear_*` linkage fields are NOT writable via Issue.Service.update
      // (ADR-0005 Phase 2 step 11). They are set only by SyncPull (on
      // insert) or SyncPush (on create-from-local) via direct DB writes.
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
        if (!current) return yield* new IssueNotFoundError({ id: input.id, context: "hierarchy check" })
        const finalLevel = p.level !== undefined ? p.level : current.level
        const finalParentId = p.parent_id !== undefined ? (p.parent_id ?? null) : current.parent_id
        if (finalLevel > 1) return yield* new IssueHierarchyError({ reason: "max_depth", detail: `${finalLevel}` })
        if (finalParentId === input.id) return yield* new IssueHierarchyError({ reason: "self_parent" })
        if (finalLevel === 0 && finalParentId !== null) {
          return yield* new IssueHierarchyError({ reason: "l1_with_parent" })
        }
        if (finalLevel === 1) {
          if (!finalParentId) return yield* new IssueHierarchyError({ reason: "l2_without_parent" })
          const parent = yield* db
            .select({ level: IssueTable.level })
            .from(IssueTable)
            .where(and(eq(IssueTable.directory, input.directory), eq(IssueTable.id, finalParentId)))
            .all()
            .pipe(Effect.orDie)
          if (parent.length === 0)
            return yield* new IssueHierarchyError({ reason: "parent_not_found", detail: finalParentId })
          if (parent[0].level !== 0) return yield* new IssueHierarchyError({ reason: "parent_not_l1" })
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
      if (!found) return yield* new IssueNotFoundError({ id: input.id, context: "after update" })
      return found
    })

    const del = Effect.fn("Issue.delete")(function* (input: { directory: string; id: string }) {
      // Active issues cannot be deleted — archive first (spec §5.4).
      const current = (yield* load(input.directory)).find((i) => i.id === input.id)
      if (!current) return yield* new IssueNotFoundError({ id: input.id, context: "before delete" })
      if (!isArchived(current.status)) return yield* new IssueNotArchivedError({ id: input.id })

      // ADR-0005 D2: Linear-linked refusal is enforced at the agent tool
      // layer (issue_delete.ts), NOT here. See `update` above for rationale.

      // Cascade delete: remove all L2 children whose parent_id points to this
      // issue (only relevant when deleting an L1), then delete the issue.
      // Uses independent delete statements (not db.transaction) per memory:
      // Drizzle db.transaction may not commit properly in Effect + Bun sqlite.
      if (current.level === 0) {
        yield* db
          .delete(IssueTable)
          .where(and(eq(IssueTable.directory, input.directory), eq(IssueTable.parent_id, input.id)))
          .run()
          .pipe(Effect.orDie)
      }
      yield* db
        .delete(IssueTable)
        .where(and(eq(IssueTable.directory, input.directory), eq(IssueTable.id, input.id)))
        .run()
        .pipe(Effect.orDie)
      yield* publish(input.directory)
      yield* events.publish(Event.Deleted, { directory: input.directory, id: input.id })
    })

    const reorder = Effect.fn("Issue.reorder")(function* (input: { directory: string; ids: string[] }) {
      // Archived issues can be reordered like any other — the previous
      // `IssueArchivedError` guard conflated UI-level disablement with
      // permission (see `update` above for the rationale).
      const all = yield* load(input.directory)

      // Position is scoped per parent: L1 items share the null-parent scope,
      // L2 items share their parent's scope. We group ids by parent_id and
      // assign sequential positions within each group, so reordering L1 does
      // not clobber L2 positions and vice versa.
      const idToParent = new Map<string, string | null>(all.map((i) => [i.id, i.parent_id] as const))

      const byParent = input.ids.reduce((acc, id) => {
        const parent = idToParent.get(id) ?? null
        const list = acc.get(parent) ?? []
        list.push(id)
        acc.set(parent, list)
        return acc
      }, new Map<string | null, string[]>())

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

    /**
     * Archive a single issue by setting its status to a terminal state
     * (spec §5.2). Idempotent: archiving an already-archived issue succeeds
     * without changing state. Does NOT cascade — L1 archive leaves its L2
     * status unchanged (the L2 rows simply become invisible to the default
     * `issue_list` view because the parent L1 is archived).
     */
    const archive = Effect.fn("Issue.archive")(function* (input: { directory: string; id: string; outcome: Outcome }) {
      const current = (yield* load(input.directory)).find((i) => i.id === input.id)
      if (!current) return yield* new IssueNotFoundError({ id: input.id, context: "before archive" })
      // Idempotent: already archived — return as-is, no state change, no event.
      if (isArchived(current.status)) return current

      // ADR-0005 D2: Linear-linked refusal is enforced at the agent tool
      // layer (issue_archive.ts), NOT here. See `update` for rationale.

      const status = OUTCOME_TO_STATUS[input.outcome]
      yield* db
        .update(IssueTable)
        .set({ status, time_updated: Date.now() })
        .where(and(eq(IssueTable.directory, input.directory), eq(IssueTable.id, input.id)))
        .run()
        .pipe(Effect.orDie)
      const issues = yield* publish(input.directory)
      const found = issues.find((i) => i.id === input.id)
      if (!found) return yield* new IssueNotFoundError({ id: input.id, context: "after archive" })
      return found
    })

    return Service.of({
      get,
      create,
      update,
      delete: del,
      reorder,
      archive,
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [EventV2Bridge.node, Database.node] })

export * as Issue from "./issue"
