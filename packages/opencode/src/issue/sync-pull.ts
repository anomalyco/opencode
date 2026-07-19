import { Context, Effect, Schema, Option } from "effect"
import { ISSUE } from "./tool-names"
import { LinearMcpClient } from "./mcp-client"
import { Issue } from "./issue"
import { LinearBinding } from "@/issue/linear-binding"
import { Database } from "@opencode-ai/core/database/database"
import { eq, and } from "drizzle-orm"
import { IssueTable } from "./issue.sql"

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

/**
 * SyncPull — snapshot-import Linear issues into the local IssueTable
 * (workspace-scoped, per ADR-0001 D1, ADR-0002 D5–D7).
 *
 * `pull({ directory })` fetches Linear issues for the configured
 * project and reconciles them into the local IssueTable:
 *
 * - Linear issues with no local `linear_issue_id` link → INSERT new row.
 * - Linked issues whose stored `last_pulled_at` matches the cloud
 *   `updatedAt` → SKIP (truly unchanged).
 * - Linked issues whose `last_pulled_at` differs (or is null) →
 *   UPDATE local fields from the cloud (cloud-wins for Linear-sourced
 *   fields). This is the reconcile path added 2026-07-09, amending
 *   ADR-0002 D5 — cloud-side edits to a Linear issue now flow down on
 *   pull instead of being silently skipped.
 *
 * Local-only issues (no `linear_issue_id`) are never touched by a pull.
 * The pull does not skip on "nothing to do" — it always runs and
 * returns honest counts (ADR-0002 D6).
 */

/**
 * Effect context tag for the Linear MCP client consumed by pull().
 * Must be provided in the layer that calls pull().
 */
export const Client = Context.Service<LinearMcpClient>("@opencode/SyncPull/Client")

/** Fatal error when pull cannot proceed at all (e.g., missing config). */
export class SyncPullError extends Schema.TaggedErrorClass<SyncPullError>()("SyncPullError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/** Summary of a pull operation. */
export class Result extends Schema.Class<Result>("SyncPullResult")({
  /** Number of issues newly inserted into the local IssueTable. */
  pulled: Schema.Number,
  /** Number of linked Linear issues whose cloud `updatedAt` was unchanged since the last pull (skipped, not updated). */
  skipped: Schema.Number,
  /** Number of linked Linear issues whose cloud `updatedAt` differed from the stored watermark (local row reconciled from cloud). */
  updated: Schema.Number,
  /** Number of local issues deleted because they no longer exist on Linear (hard-deleted on cloud). */
  deleted: Schema.Number,
  /** Number of issues that failed to pull. */
  failed: Schema.Number,
  /** Linear issue IDs that were pulled (newly inserted). */
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
 * The active set — Linear workflow state types that a pull imports.
 *
 * Historically this was `new Set(["unstarted", "started"])` which
 * excluded `completed`/`canceled` cloud issues from pull. Per user
 * intent (2026-07-19): "归档的语义仅为该待办已经处理完成" — local
 * archive (Done/Canceled/Duplicate) just means "completed", not
 * "deleted". Pull/push must still consider these issues so cloud-side
 * state changes (e.g., Linear issue moved to Done) flow down to local.
 *
 * The filter now only excludes truly archived (soft-deleted) cloud
 * issues — those carry a non-null `archivedAt` and are handled by the
 * deletion sync at the end of pull.
 */

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

const parseJson = (text: string): unknown => Option.getOrUndefined(decodeJson(text))

// The REAL Linear MCP `list_issues` returns `content[0].text` decoding to a
// flat top-level object: `{ issues: [...], hasNextPage: boolean }`. There is
// NO `data` wrapper and NO `nodes`/`pageInfo` nesting. We still accept the
// legacy `{ data: { issues: { nodes, pageInfo } } }` shape defensively, but
// the real shape is the only one the live server produces (verified via
// `script/issue-linear-probe.ts`, captured in
// `__fixtures__/linear-list-issues-real.json`).
const parseIssues = (raw: unknown): { nodes: unknown[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string } } => {
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
        const parsed = parseJson(c.text)
        if (!parsed || typeof parsed !== "object") continue
        const p = parsed as Record<string, unknown>

        // Real shape: { issues: [...], hasNextPage: boolean }
        if (Array.isArray(p.issues)) {
          return {
            nodes: p.issues,
            pageInfo: { hasNextPage: !!p.hasNextPage },
          }
        }

        // Legacy/defensive shape: { data: { issues: { nodes, pageInfo } } }
        if (p.data && typeof p.data === "object") {
          const d = p.data as Record<string, unknown>
          const issues = d.issues
          if (issues && typeof issues === "object") {
            const ig = issues as Record<string, unknown>
            if (Array.isArray(ig.nodes)) {
              return {
                nodes: ig.nodes,
                pageInfo: ig.pageInfo as { hasNextPage?: boolean; endCursor?: string } | undefined,
              }
            }
            // data.issues may itself be a flat array
            if (Array.isArray(issues)) {
              return { nodes: issues, pageInfo: undefined }
            }
          }
        }
      }
    }
  }

  return def
}

/**
 * Extract Linear issue status name. The REAL MCP `list_issues` returns
 * a `status` field on each issue node (e.g., "In Progress", "Todo",
 * "Backlog"). This is the workflow state name, stored verbatim as
 * Issue.Status — no mapping needed. Falls back to undefined when the
 * field is absent.
 */
const readStatusName = (i: Record<string, unknown>): string | undefined => {
  if (typeof i.status === "string" && i.status.length > 0) return i.status
  return undefined
}

/**
 * Extract Linear priority as a number. The REAL MCP returns
 * `priority: { value: number, name: string }` (object). The legacy shape
 * returned a bare number. We accept both.
 */
const readPriorityValue = (i: Record<string, unknown>): number | undefined => {
  const p = i.priority
  if (typeof p === "number") return p
  if (p && typeof p === "object") {
    const v = (p as Record<string, unknown>).value
    if (typeof v === "number") return v
  }
  return undefined
}

/**
 * Extract Linear's cloud-side `updatedAt` (ISO-8601 string) and convert
 * to Unix ms for storage in `IssueTable.last_pulled_at`. Used as the
 * change-detection watermark so a pull can reconcile cloud-side edits
 * instead of skipping already-linked issues (ADR-0002 D5 revised).
 * Returns undefined when Linear did not report an `updatedAt`.
 */
const readUpdatedAtMs = (i: Record<string, unknown>): number | undefined => {
  const raw = i.updatedAt
  if (typeof raw !== "string") return undefined
  const ms = Date.parse(raw)
  return Number.isNaN(ms) ? undefined : ms
}

/**
 * Extract Linear's `parentId` field. The MCP `list_issues` returns
 * `parentId` as a Linear issue identifier (e.g., "BOR-15"), or null
 * for top-level issues. Returns null when the issue is top-level (L1),
 * or the identifier string when it's a sub-issue (L2).
 */
const readParentId = (i: Record<string, unknown>): string | null => {
  const v = i.parentId
  return typeof v === "string" && v.length > 0 ? v : null
}

const extractLabels = (raw: unknown): string[] => {
  if (Array.isArray(raw)) {
    // Real shape: labels is a flat string[] (e.g. ["Feature"]).
    return raw.filter((n): n is string => typeof n === "string").filter(Boolean)
  }
  if (!raw || typeof raw !== "object") return []
  const r = raw as Record<string, unknown>
  // Legacy shape: labels is { nodes: [{ name }] }.
  if (Array.isArray(r.nodes)) {
    return r.nodes
      .filter((n): n is Record<string, unknown> => typeof n === "object" && n !== null)
      .map((n) => (typeof n.name === "string" ? n.name : ""))
      .filter(Boolean)
  }
  return []
}

/**
 * Normalize a Linear date string to `YYYY-MM-DD` for storage.
 * Linear returns timestamps in full ISO-8601 (e.g.
 * `2026-07-15T00:00:00.000Z`), but the HTML `<input type="date">` used
 * by the Todo edit dialog requires exactly `YYYY-MM-DD`. This helper
 * extracts the date portion from any ISO string, or returns the input
 * unchanged if it's already 10 chars or less.
 */
const normalizeDate = (raw: string | null | undefined): string | null => {
  if (!raw || typeof raw !== "string") return null
  // Already YYYY-MM-DD or shorter — return as-is.
  if (raw.length <= 10) return raw
  // ISO datetime — take the first 10 chars (the date part).
  return raw.substring(0, 10)
}

/**
 * Check if a Linear issue node is archived (soft-deleted). Linear's
 * `list_issues` includes archived issues by default (the
 * `includeArchived` parameter defaults to true). Archived issues carry
 * a non-null `archivedAt` timestamp. Used to exclude archived issues
 * from INSERT/UPDATE and to detect local rows that should be deleted
 * (archived on cloud = deleted locally).
 */
const isArchived = (i: Record<string, unknown>): boolean => {
  const v = i.archivedAt
  return v != null && (typeof v === "string" ? v.length > 0 : true)
}

/**
 * Map a Linear issue node to the Linear-sourced fields of Issue.Info.
 * Used by both the batch `pull` (INSERT + UPDATE paths) and `pullOne`.
 * Local-only fields (id, directory, parent_id, level, position,
 * last_pushed_at) are never set here — they are either auto-generated on
 * insert or preserved across an update.
 *
 * Status mapping: the Linear `status` field (workflow state name, e.g.
 * "In Progress") is stored verbatim as Issue.Status — no mapping needed.
 * Status classification (Active vs Archived) is derived by matching
 * against the 7 Linear default status names directly, so no separate
 * classification field is stored.
 *
 * `cloud_shadow` is built from the same Linear-sourced content fields so
 * that, after a cloud-wins reconcile, the shadow exactly mirrors what
 * `Issue.buildShadow(localRowAfterUpdate)` would produce. This lets a
 * subsequent single-issue push correctly detect only the fields the user
 * has since edited locally. `due_date`/`assignee_id` are normalized to
 * null (not undefined) so the JSON-stringified shadow matches the values
 * read back from the DB column (which also stores null for absent values).
 */
const mapLinearFields = (
  i: Record<string, unknown>,
  linearId: string,
  cfg: { teamId: string; projectId: string },
): Partial<Issue.Info> => {
  const priorityValue = readPriorityValue(i)
  const updatedAtMs = readUpdatedAtMs(i)
  const title = typeof i.title === "string" ? i.title : "Untitled"
  const description = typeof i.description === "string" ? i.description : ""
  // Store the Linear workflow state name verbatim — no mapping.
  // Fall back to DEFAULT_STATUS when Linear omits the `status` field.
  const status: Issue.Status = readStatusName(i) ?? Issue.DEFAULT_STATUS
  const priority: Issue.Priority = priorityValue !== undefined ? mapReversePriority(priorityValue) : "none"
  const labels = extractLabels(i.labels)
  const due_date = normalizeDate(typeof i.dueDate === "string" ? i.dueDate : null)
  const assignee_id = typeof i.assigneeId === "string" ? i.assigneeId : null
  return {
    content: title,
    title,
    description,
    status,
    priority,
    labels,
    due_date,
    linear_issue_id: linearId,
    linear_team_id: typeof i.teamId === "string" ? i.teamId : cfg.teamId,
    linear_project_id: typeof i.projectId === "string" ? i.projectId : cfg.projectId,
    assignee_id,
    // Always refresh the watermark from the cloud so the next pull can
    // detect subsequent cloud-side edits.
    last_pulled_at: updatedAtMs ?? null,
    // Shadow mirrors the Linear-sourced content fields as they now
    // appear in the local row after the cloud-wins reconcile.
    cloud_shadow: {
      title,
      content: title,
      description,
      status,
      priority,
      labels,
      due_date,
      assignee_id,
    },
  }
}

/**
 * Parse a `get_issue` MCP response and return the raw issue node (the
 * object containing id/title/description/status/priority/labels/etc).
 * Returns undefined if the response shape is unrecognized. Accepts both
 * the flat shape `{ id, title, ... }` and the GraphQL shape
 * `{ data: { issue: { id, title, ... } } }`. The MCP wraps the JSON in
 * `content[0].text`, same as `list_issues`.
 */
const parseGetIssueNode = (raw: unknown): Record<string, unknown> | undefined => {
  if (!raw || typeof raw !== "object") return undefined
  const r = raw as Record<string, unknown>

  if (Array.isArray(r.content)) {
    for (const item of r.content) {
      if (typeof item !== "object" || !item) continue
      const c = item as Record<string, unknown>
      if (c.type === "text" && typeof c.text === "string") {
        const parsed = Option.getOrUndefined(decodeJson(c.text))
        if (!parsed || typeof parsed !== "object") continue
        const p = parsed as Record<string, unknown>
        // Flat shape: { id, title, ... }
        if (typeof p.id === "string") return p
        // GraphQL shape: { data: { issue: { id, ... } } }
        const data = p.data
        if (data && typeof data === "object") {
          const d = data as Record<string, unknown>
          const issue = d.issue
          if (issue && typeof issue === "object") {
            const i = issue as Record<string, unknown>
            if (typeof i.id === "string") return i
          }
        }
      }
    }
  }
  return undefined
}

/**
 * Build a raw DB `UPDATE` set from a pull patch. Pull is a cloud-wins
 * reconcile — it must bypass `Issue.update`'s archive guard so archived
 * local rows (Done/Canceled/Duplicate) can still be reconciled from
 * cloud-side state changes. `time_updated` is passed through verbatim
 * (caller preserves the local value) so the local-side dirty marker
 * is not bumped by cloud-sourced updates.
 *
 * `cloud_shadow` and `labels` are JSON-stringified to match the DB
 * column format (TEXT storing JSON). Null-valued optional fields are
 * normalized to SQL NULL.
 */
const buildPullUpdateSet = (patch: Partial<Issue.Info>): Record<string, unknown> => {
  const set: Record<string, unknown> = {}
  if (patch.content !== undefined) set.content = patch.content
  if (patch.title !== undefined) set.title = patch.title
  if (patch.description !== undefined) set.description = patch.description
  if (patch.status !== undefined) set.status = patch.status
  if (patch.priority !== undefined) set.priority = patch.priority
  if (patch.labels !== undefined) set.labels = JSON.stringify(patch.labels)
  if (patch.due_date !== undefined) set.due_date = patch.due_date ?? null
  if (patch.assignee_id !== undefined) set.assignee_id = patch.assignee_id ?? null
  if (patch.linear_issue_id !== undefined) set.linear_issue_id = patch.linear_issue_id ?? null
  if (patch.linear_team_id !== undefined) set.linear_team_id = patch.linear_team_id ?? null
  if (patch.linear_project_id !== undefined) set.linear_project_id = patch.linear_project_id ?? null
  if (patch.last_pulled_at !== undefined) set.last_pulled_at = patch.last_pulled_at ?? null
  if (patch.cloud_shadow !== undefined)
    set.cloud_shadow = patch.cloud_shadow != null ? JSON.stringify(patch.cloud_shadow) : null
  if (patch.time_updated !== undefined) set.time_updated = patch.time_updated
  return set
}

/**
 * Hard-delete a local issue row by id, bypassing `Issue.delete`'s
 * "must be archived first" guard. Used by pull's deletion sync and
 * dedup cleanup — in both contexts the row must be removed regardless
 * of its local archive status (cloud archived → local delete;
 * duplicate → local delete). L1 rows (level 0) cascade-delete their
 * L2 children (same as `Issue.delete` for archived L1).
 *
 * Errors are NOT converted to defects (no `Effect.orDie`) so callers
 * can catch them via `Effect.catch` and record per-row failures
 * without aborting the whole pull. Defects (Interrupt/Die) still
 * propagate naturally per AGENTS.md.
 */
const rawDelete = (directory: string, id: string, level: number): Effect.Effect<void, unknown, Database.Service> =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    if (level === 0) {
      yield* db
        .delete(IssueTable)
        .where(and(eq(IssueTable.directory, directory), eq(IssueTable.parent_id, id)))
        .run()
    }
    yield* db
      .delete(IssueTable)
      .where(and(eq(IssueTable.directory, directory), eq(IssueTable.id, id)))
      .run()
  })

/**
 * Pull Linear issues into the local IssueTable for the given workspace.
 *
 * - Fetches issues for the configured project via `list_issues` (paginated,
 *   50/page). All non-archived cloud issues are reconciled — including
 *   Done/Canceled/Duplicate states. Per user intent (2026-07-19): "归档
 *   的语义仅为该待办已经处理完成" — local archive just means "completed",
 *   pull/push must still consider these issues. Only truly archived
 *   (soft-deleted, `archivedAt` set) cloud issues are excluded.
 * - For each cloud issue:
 *   - Not linked locally → INSERT new row.
 *   - Linked and stored `last_pulled_at` === cloud `updatedAt` → SKIP.
 *   - Linked and `last_pulled_at` differs (or is null) → UPDATE local
 *     fields from cloud (cloud-wins reconcile, raw DB write bypasses
 *     the archive guard so archived locals still get updated).
 * - Dedup: if multiple local rows link to the same `linear_issue_id`,
 *   keep the first and hard-delete the rest (with L2 cascade for L1
 *   duplicates). This cleans up duplicates created by older pull bugs
 *   that inserted new rows without seeing existing archived links.
 * - Deletion sync: local rows whose `linear_issue_id` is no longer
 *   present as a non-archived cloud issue are hard-deleted (with L2
 *   cascade for L1). This handles Linear-side archive (soft-delete)
 *   and hard-delete.
 * - Returns honest counts (pulled/updated/skipped/deleted/failed).
 */
export const pull = Effect.fn("SyncPull.pull")(function* (input: { directory: string }) {
  // ADR-0004: team/project binding is workspace-scoped, read from
  // LinearBinding.Service (<workspace>/.opencode/linear-binding.json),
  // NOT from the global Config.Linear which now only has syncMode/autoPush.
  const bindingSvc = yield* LinearBinding.Service
  const binding = yield* bindingSvc.get()

  if (!binding?.projectId || !binding?.teamId) {
    return yield* Effect.fail(new SyncPullError({ message: "Linear binding missing projectId or teamId" }))
  }
  const cfg = binding

  const client = yield* Client
  const issueSvc = yield* Issue.Service
  const { db } = yield* Database.Service
  // Use include_archived: true so pull sees ALL local rows, including
  // archived ones (Done/Canceled/Duplicate). Without this, a previously-
  // pulled issue that was later archived locally would be invisible to
  // pull — pull would insert a NEW row for the same Linear issue,
  // creating duplicates. This was the root cause of the 3× "Test Issue 3"
  // rows all linking to BOR-12.
  const existing = yield* issueSvc.get({ directory: input.directory, include_archived: true })

  // Map linear_issue_id → ALL local rows linking to it. A
  // `linear_issue_id` mapping to multiple local rows is a duplicate
  // state that arises when an older pull inserted a new row without
  // seeing an existing archived link. Pull reconciles by keeping the
  // first row (oldest by iteration order = insertion order) for
  // UPDATE/SKIP decisions and hard-deleting the rest (see `toDedup`).
  const linkedMulti = new Map<string, Issue.Info[]>()
  for (const i of existing) {
    if (!i.linear_issue_id) continue
    const list = linkedMulti.get(i.linear_issue_id) ?? []
    list.push(i)
    linkedMulti.set(i.linear_issue_id, list)
  }
  // First local row per linear_issue_id — the one we keep and reconcile.
  const linked = new Map<string, Issue.Info>()
  for (const [linearId, rows] of linkedMulti) {
    if (rows.length > 0) linked.set(linearId, rows[0])
  }
  // Duplicates to hard-delete after the main reconcile loop. These are
  // all rows except the first for each linear_issue_id.
  const toDedup: Issue.Info[] = []
  for (const [, rows] of linkedMulti) {
    if (rows.length > 1) toDedup.push(...rows.slice(1))
  }

  // Per-row outcomes collected from the INSERT/UPDATE phases; counts
  // are derived from these arrays after Effect.all completes (AGENTS.md:
  // Prefer const over let — no `let pulled/skipped/updated/deleted`).
  const skipReasons: string[] = []
  const ids: string[] = []
  const errors: Array<{ linearIssueId: string; error: string }> = []

  const allIssues: unknown[] = []
  // Recursive pagination — avoids `let cursor`/`let hasNextPage` mutation
  // (AGENTS.md: Prefer const over let). Linear's `list_issues` returns at
  // most 50 issues per page; recursion depth = ceil(totalIssues/50), well
  // within JS stack limits even for projects with tens of thousands of
  // issues. A batch-level MCP error short-circuits the recursion by
  // recording the error and returning early.
  const fetchPages: (cursor: string | undefined) => Effect.Effect<void> = Effect.fnUntraced(function* (cursor: string | undefined) {
    const args: Record<string, unknown> = { project: cfg.projectId, limit: 50 }
    if (cursor) args.cursor = cursor

    const raw = yield* client.callTool(ISSUE.LIST, args).pipe(
      // Catch only the expected LinearMcpError from the MCP call;
      // defects (Interrupt/Die) propagate naturally — `Effect.catchTag`
      // only handles recoverable typed errors.
      Effect.catchTag("LinearMcpError", (e) =>
        Effect.succeed({ _error: true, message: e.message }),
      ),
    )

    if (typeof raw === "object" && raw !== null && "_error" in raw) {
      const msg = String((raw as Record<string, unknown>).message ?? "unknown MCP error")
      errors.push({ linearIssueId: "<batch>", error: msg })
      return
    }

    const parsed = parseIssues(raw)
    for (const node of parsed.nodes) allIssues.push(node)

    const hasMore = !!(parsed.pageInfo?.hasNextPage && parsed.pageInfo?.endCursor)
    if (!hasMore) return
    yield* fetchPages(parsed.pageInfo!.endCursor)
  })
  yield* fetchPages(undefined)

  // Filter: only exclude truly archived (soft-deleted) cloud issues.
  // All other issues — including Done/Canceled/Duplicate — are
  // reconciled, per user intent (2026-07-19): local archive just means
  // "completed", pull must still consider these issues. Archived cloud
  // issues (archivedAt set) are handled by the deletion sync at the end.
  const activeIssues = allIssues.filter((node) => {
    const i = node as Record<string, unknown>
    return !isArchived(i)
  })

  const toInsertL1: Array<{ linearIssueId: string; fields: Partial<Issue.Info> }> = []
  const toInsertL2: Array<{ linearIssueId: string; parentLinearId: string; fields: Partial<Issue.Info> }> = []
  const toUpdate: Array<{ localId: string; linearIssueId: string; patch: Partial<Issue.Info> }> = []
  // Issues whose watermark moved but content fields are identical — refresh
  // only `last_pulled_at` and `cloud_shadow`, counted as skipped.
  const toWatermarkRefresh: Array<{ localId: string; patch: Partial<Issue.Info> }> = []

  for (const issue of activeIssues) {
    const i = issue as Record<string, unknown>
    const linearId = typeof i.id === "string" ? i.id : undefined
    if (!linearId) continue

    const parentLinearId = readParentId(i)

    const local = linked.get(linearId)
    if (!local) {
      // Not linked locally → INSERT. Split into L1 (no parent) and L2 (has parent).
      // L2 inserts are deferred until L1 inserts complete so we can resolve
      // the parent's local id via linear_issue_id lookup.
      const fields = mapLinearFields(i, linearId, cfg)
      if (parentLinearId === null) {
        toInsertL1.push({ linearIssueId: linearId, fields: { ...fields, level: 0 } })
        continue
      }
      toInsertL2.push({ linearIssueId: linearId, parentLinearId, fields })
      continue
    }

    // Linked — decide SKIP vs UPDATE by comparing the cloud `updatedAt`
    // watermark. If the cloud didn't report an `updatedAt` we cannot
    // detect a change, so we conservatively SKIP to avoid an unconditional
    // overwrite on every pull (matches the pre-reconcile behaviour for
    // servers that don't return `updatedAt`).
    const cloudUpdatedAt = readUpdatedAtMs(i)
    if (cloudUpdatedAt === undefined) {
      skipReasons.push("no-cloud-watermark")
      continue
    }
    if (local.last_pulled_at !== undefined && local.last_pulled_at === cloudUpdatedAt) {
      skipReasons.push("watermark-match")
      continue
    }

    // Cloud moved (or local watermark is null on the first post-migration
    // pull) → reconcile: overwrite the Linear-sourced fields from cloud.
    // Per ADR-0002 D5 (revised), cloud-wins for Linear-sourced fields.
    const patch = mapLinearFields(i, linearId, cfg)

    // ADR-0002 (2026-07-09 amendment): pull must NEVER overwrite local-only
    // hierarchy fields — `id`, `directory`, `parent_id`, `level`, `position`,
    // `last_pushed_at`, `time_created`, `time_updated`. The cloud `parentId`
    // is intentionally NOT reconciled into the local row. Hierarchy is a
    // local-only concern; users may re-parent issues via the UI/tools.
    // `mapLinearFields` already omits these fields, so `patch` only carries
    // Linear-sourced content. No additional hierarchy reconciliation here.

    // Content-equivalence check: if all Linear-sourced content fields in
    // the patch match the local row's current values, the only thing that
    // changed is the `updatedAt` watermark. Hierarchy fields are never in
    // the patch (see comment above), so they're not part of this check.
    const contentChanged = Issue.SHADOW_FIELDS.some((f) => {
      const localVal = local[f]
      const cloudVal = patch[f]
      return JSON.stringify(localVal) !== JSON.stringify(cloudVal)
    })
    if (!contentChanged) {
      toWatermarkRefresh.push({
        localId: local.id,
        patch: {
          last_pulled_at: patch.last_pulled_at,
          cloud_shadow: patch.cloud_shadow,
        },
      })
      skipReasons.push("content-unchanged")
      continue
    }

    // Preserve the local `time_updated` value to prevent `Issue.update`'s
    // auto-bump from firing on cloud-sourced content updates. Per ADR-0002
    // D5 (2026-07-09 amendment), pull must NEVER overwrite `time_updated` —
    // it records local edit time and serves as the local-side dirty marker
    // for push. The auto-bump in `Issue.update` is skipped when
    // `p.time_updated !== undefined`, so we explicitly pass the existing
    // local value through. Cloud-side watermark is recorded in
    // `last_pulled_at` (already set by `mapLinearFields`).
    toUpdate.push({
      localId: local.id,
      linearIssueId: linearId,
      patch: { ...patch, time_updated: local.time_updated },
    })
  }

  // Phase 1: INSERT all L1 issues (no parent) first.
  // Outcome-based aggregation (AGENTS.md: Prefer const over let) — each
  // Effect.gen returns its outcome; counts/ids/errors are derived from
  // the collected outcomes after Effect.all completes.
  const insertL1Outcomes = yield* Effect.all(
    toInsertL1.map(({ linearIssueId, fields }) =>
      Effect.gen(function* () {
        const created = yield* issueSvc.create({ directory: input.directory, issue: fields }).pipe(
          // issueSvc.create may throw DB errors; catch all recoverable
          // errors, let defects propagate.
          Effect.catch((e: unknown) =>
            Effect.succeed({
              _error: true,
              message: e instanceof Error ? e.message : String(e),
              issueId: linearIssueId,
            }),
          ),
        )

        if (typeof created === "object" && created !== null && "_error" in created) {
          const r = created as Record<string, unknown>
          return { ok: false as const, linearIssueId: (r.issueId as string) || linearIssueId, error: (r.message as string) || "unknown" }
        }

        return { ok: true as const, linearIssueId }
      }),
    ),
    { concurrency: DEFAULT_BATCH },
  )
  for (const o of insertL1Outcomes) {
    if (o.ok) ids.push(o.linearIssueId)
    else errors.push({ linearIssueId: o.linearIssueId, error: o.error })
  }

  // After L1 inserts, rebuild the linked map so L2 inserts can resolve
  // their parent's local id via linear_issue_id.
  const linkedAfterL1 = yield* issueSvc.get({ directory: input.directory })
  const linkedMapAfterL1 = new Map<string, Issue.Info>()
  for (const i of linkedAfterL1) {
    if (i.linear_issue_id) linkedMapAfterL1.set(i.linear_issue_id, i)
  }

  // Phase 2: INSERT all L2 issues (with parent), now that parents exist locally.
  const insertL2Outcomes = yield* Effect.all(
    toInsertL2.map(({ linearIssueId, parentLinearId, fields }) =>
      Effect.gen(function* () {
        const parentLocal = linkedMapAfterL1.get(parentLinearId)
        if (!parentLocal) {
          // Parent not linked locally (may have been filtered by statusType).
          // Fall back to inserting as L1 so the issue isn't lost.
          const created = yield* issueSvc
            .create({
              directory: input.directory,
              issue: { ...fields, level: 0 },
            })
            .pipe(
              Effect.catch((e: unknown) =>
                Effect.succeed({
                  _error: true,
                  message: e instanceof Error ? e.message : String(e),
                  issueId: linearIssueId,
                }),
              ),
            )
          if (typeof created === "object" && created !== null && "_error" in created) {
            const r = created as Record<string, unknown>
            return { ok: false as const, linearIssueId: (r.issueId as string) || linearIssueId, error: (r.message as string) || "unknown" }
          }
          return { ok: true as const, linearIssueId }
        }

        const created = yield* issueSvc
          .create({
            directory: input.directory,
            issue: { ...fields, level: 1, parent_id: parentLocal.id },
          })
          .pipe(
            Effect.catch((e: unknown) =>
              Effect.succeed({
                _error: true,
                message: e instanceof Error ? e.message : String(e),
                issueId: linearIssueId,
              }),
            ),
          )

        if (typeof created === "object" && created !== null && "_error" in created) {
          const r = created as Record<string, unknown>
          return { ok: false as const, linearIssueId: (r.issueId as string) || linearIssueId, error: (r.message as string) || "unknown" }
        }

        return { ok: true as const, linearIssueId }
      }),
    ),
    { concurrency: DEFAULT_BATCH },
  )
  for (const o of insertL2Outcomes) {
    if (o.ok) ids.push(o.linearIssueId)
    else errors.push({ linearIssueId: o.linearIssueId, error: o.error })
  }

  // UPDATE path: raw `db.update` (not `issueSvc.update`) to avoid
  // publishing `issue.updated` events during a batch pull (the desktop
  // UI refreshes via `serverSync().todo.refresh(directory)` after pull).
  // Historically this also bypassed the now-removed `IssueArchivedError`
  // guard so archived local rows could be reconciled from cloud-side
  // state changes; the guard is gone (ADR-0001 Amendment 2026-07-19
  // §D17), but the raw-write pattern is retained because pull is a
  // batch operation that should not fan out N bus events.
  const updateOutcomesRaw = yield* Effect.all(
    toUpdate.map(({ localId, linearIssueId, patch }) =>
      Effect.gen(function* () {
        const set = buildPullUpdateSet(patch)
        const result = yield* db
          .update(IssueTable)
          .set(set)
          .where(and(eq(IssueTable.directory, input.directory), eq(IssueTable.id, localId)))
          .run()
          .pipe(
            // Catch only recoverable typed errors (e.g., Drizzle's
            // DB errors); defects (Interrupt/Die) propagate naturally
            // per AGENTS.md. A failure here is recorded per-row so the
            // whole pull is not aborted.
            Effect.catch((e: unknown) =>
              Effect.succeed({
                _error: true,
                message: e instanceof Error ? e.message : String(e),
                issueId: linearIssueId,
              }),
            ),
          )

        if (typeof result === "object" && result !== null && "_error" in result) {
          const r = result as Record<string, unknown>
          return { ok: false as const, linearIssueId: (r.issueId as string) || linearIssueId, error: (r.message as string) || "unknown" }
        }
        return { ok: true as const }
      }),
    ),
    { concurrency: DEFAULT_BATCH },
  )
  for (const o of updateOutcomesRaw) {
    if (!o.ok) errors.push({ linearIssueId: o.linearIssueId, error: o.error })
  }

  // Watermark-only refresh: content fields are identical, just sync the
  // `last_pulled_at` watermark and `cloud_shadow` so the next pull
  // doesn't see the same mismatch. These are already counted as skipped
  // in the loop above. Also uses raw `db.update` for the same archive-
  // guard bypass reason. Best-effort: a per-row failure is logged and
  // swallowed (the next pull will retry); defects propagate.
  yield* Effect.all(
    toWatermarkRefresh.map(({ localId, patch }) =>
      Effect.gen(function* () {
        const set = buildPullUpdateSet(patch)
        yield* db
          .update(IssueTable)
          .set(set)
          .where(and(eq(IssueTable.directory, input.directory), eq(IssueTable.id, localId)))
          .run()
          .pipe(
            // Best-effort: log + swallow recoverable errors (next pull
            // retries); defects (Interrupt/Die) propagate naturally
            // (Effect.catch does not catch them).
            Effect.catch((e: unknown) =>
              Effect.logWarning(`[SyncPull.watermarkRefresh] failed for ${localId}: ${String(e)}`),
            ),
          )
      }),
    ),
    { concurrency: DEFAULT_BATCH, discard: true },
  )

  // Deletion sync: remove local issues whose `linear_issue_id` is no
  // longer present on Linear as a non-archived cloud issue. Linear's
  // "delete" is actually "archive" — `list_issues` returns archived
  // issues with a non-null `archivedAt`. We treat truly archived cloud
  // issues (and any linear_issue_id absent from the cloud list) as
  // deleted locally. Issues merely in a Done/Canceled/Duplicate state
  // are NOT deleted — those are kept (per user intent 2026-07-19:
  // "归档的语义仅为该待办已经处理完成") so pull/push can still
  // reconcile their content. Only truly archived/absent issues are.
  //
  // Uses `rawDelete` (not `issueSvc.delete`) so the "must be archived
  // first" guard is bypassed — the local row may be Active while the
  // cloud issue was archived, and we must still delete it. L1 rows
  // cascade-delete their L2 children.
  //
  // Skipped when the batch `list_issues` call failed, because a partial
  // cloud list would cause spurious local deletions.
  // Deletion outcomes — collected only when the batch list_issues call
  // succeeded. A `const deleteOutcomes` array (declared outside the
  // `if (!batchFailed)` block) lets us compute `const deleted` after.
  const deleteOutcomes: Array<{ ok: true } | { ok: false; linearIssueId: string; error: string }> = []
  const batchFailed = errors.some((e) => e.linearIssueId === "<batch>")
  if (!batchFailed) {
    const cloudActiveIds = new Set<string>()
    for (const node of allIssues) {
      const i = node as Record<string, unknown>
      if (isArchived(i)) continue
      const id = typeof i.id === "string" ? i.id : undefined
      if (id) cloudActiveIds.add(id)
    }
    const toDelete: Array<{ local: Issue.Info; linearIssueId: string }> = []
    for (const [linearIssueId, local] of linked) {
      if (!cloudActiveIds.has(linearIssueId)) {
        toDelete.push({ local, linearIssueId })
      }
    }
    const deleteResults = yield* Effect.all(
      toDelete.map(({ local, linearIssueId }) =>
        Effect.gen(function* () {
          const result = yield* rawDelete(input.directory, local.id, local.level).pipe(
            Effect.catch((e: unknown) =>
              Effect.succeed({
                _error: true,
                message: e instanceof Error ? e.message : String(e),
              }),
            ),
          )
          if (typeof result === "object" && result !== null && "_error" in result) {
            const r = result as Record<string, unknown>
            return { ok: false as const, linearIssueId, error: (r.message as string) || "unknown" }
          }
          return { ok: true as const }
        }),
      ),
      { concurrency: DEFAULT_BATCH },
    )
    for (const o of deleteResults) deleteOutcomes.push(o)

    // Dedup cleanup: hard-delete duplicate local rows that link to the
    // same `linear_issue_id` as another row. These arose from older
    // pull bugs that inserted new rows without seeing existing archived
    // links (root cause of the 3× "Test Issue 3" rows linking to
    // BOR-12). The first row per linear_issue_id is kept (reconciled
    // above); all others are hard-deleted. L1 duplicates cascade-delete
    // their L2 children. Counted as `deleted` since rows are removed.
    const dedupResults = yield* Effect.all(
      toDedup.map((local) =>
        Effect.gen(function* () {
          const result = yield* rawDelete(input.directory, local.id, local.level).pipe(
            Effect.catch((e: unknown) =>
              Effect.succeed({
                _error: true,
                message: e instanceof Error ? e.message : String(e),
              }),
            ),
          )
          if (typeof result === "object" && result !== null && "_error" in result) {
            const r = result as Record<string, unknown>
            return { ok: false as const, linearIssueId: local.linear_issue_id ?? local.id, error: (r.message as string) || "unknown" }
          }
          return { ok: true as const }
        }),
      ),
      { concurrency: DEFAULT_BATCH },
    )
    for (const o of dedupResults) deleteOutcomes.push(o)
  }
  for (const o of deleteOutcomes) {
    if (!o.ok) errors.push({ linearIssueId: o.linearIssueId, error: o.error })
  }

  // Derive counts from outcome arrays (AGENTS.md: Prefer const over let —
  // no `let pulled/skipped/updated/deleted` counters).
  const pulled = insertL1Outcomes.concat(insertL2Outcomes).filter((o) => o.ok).length
  const skipped = skipReasons.length
  const updated = updateOutcomesRaw.filter((o) => o.ok).length
  const deleted = deleteOutcomes.filter((o) => o.ok).length

  return new Result({ pulled, skipped, updated, deleted, failed: errors.length, ids, errors })
})

export * as SyncPull from "./sync-pull"
