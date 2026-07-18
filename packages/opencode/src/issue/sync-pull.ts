import { Context, Effect, Schema, Option } from "effect"
import { ISSUE } from "./tool-names"
import { LinearMcpClient } from "./mcp-client"
import { LinearMcpError } from "./mcp-client"
import { Issue } from "./issue"
import { LinearBinding } from "@/issue/linear-binding"

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
export class Error extends Schema.TaggedErrorClass<Error>()("SyncPullError", {
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
 * Per ADR-0002 D5 step 3, only issues whose `statusType` is in this
 * set are reconciled into the local IssueTable. Issues in `completed`,
 * `canceled`, or any other state type are skipped by the pull.
 */
const ACTIVE_STATES = new Set(["unstarted", "started"])

/**
 * Extract Linear's `statusType` field (e.g. `"unstarted"`, `"started"`,
 * `"completed"`, `"canceled"`) from a `list_issues` node. The real MCP
 * response includes this on every issue node (see
 * `__fixtures__/linear-list-issues-real.json`). Returns undefined when
 * the field is absent — callers treat undefined as "not in the active
 * set" so such nodes are filtered out by the active-set filter.
 */
const readStatusType = (i: Record<string, unknown>): string | undefined => {
  const v = i.statusType
  return typeof v === "string" && v.length > 0 ? v : undefined
}

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

const safeParse = (text: string): unknown => Option.getOrUndefined(decodeJson(text))

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
        const parsed = safeParse(c.text)
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
 * AutoProgress classifies states by matching against the 7 Linear default
 * status names directly, so no separate classification field is stored.
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
 * Pull Linear issues into the local IssueTable for the given workspace.
 *
 * - Fetches issues for the configured project via `list_issues` (paginated,
 *   50/page) and filters to the **active set** — issues whose `statusType`
 *   is `unstarted` or `started` (ADR-0002 D5 step 3). Issues in `completed`,
 *   `canceled`, or other state types are skipped by the pull.
 * - For each active Linear issue:
 *   - Not linked locally → INSERT new row.
 *   - Linked and stored `last_pulled_at` === cloud `updatedAt` → SKIP.
 *   - Linked and `last_pulled_at` differs (or is null) → UPDATE local
 *     fields from cloud (cloud-wins reconcile, ADR-0002 D5 revised).
 * - Returns honest counts (pulled/updated/skipped/failed) — no "already up to date" euphemism.
 * - Does NOT delete local rows when Linear issues are archived or disappear
 *   (ADR-0002 D6 defers deletion to a follow-up ADR).
 */
export const pull = Effect.fn("SyncPull.pull")(function* (input: { directory: string }) {
  // ADR-0004: team/project binding is workspace-scoped, read from
  // LinearBinding.Service (<workspace>/.opencode/linear-binding.json),
  // NOT from the global Config.Linear which now only has syncMode/autoPush.
  const bindingSvc = yield* LinearBinding.Service
  const binding = yield* bindingSvc.get()

  if (!binding?.projectId || !binding?.teamId) {
    return yield* Effect.fail(new Error({ message: "Linear binding missing projectId or teamId" }))
  }
  const cfg = binding

  const client = yield* Client
  const issueSvc = yield* Issue.Service
  const existing = yield* issueSvc.get({ directory: input.directory })

  // Map linear_issue_id → existing local Issue.Info, so the loop can both
  // detect "already linked" and read the stored `last_pulled_at` watermark
  // to decide between SKIP (unchanged) and UPDATE (cloud moved).
  const linked = new Map<string, Issue.Info>()
  for (const i of existing) {
    if (i.linear_issue_id) linked.set(i.linear_issue_id, i)
  }

  let pulled = 0
  let skipped = 0
  let updated = 0
  const ids: string[] = []
  const errors: Array<{ linearIssueId: string; error: string }> = []

  const allIssues: unknown[] = []
  let cursor: string | undefined
  let hasNextPage = true

  while (hasNextPage) {
    const args: Record<string, unknown> = { project: cfg.projectId, limit: 50 }
    if (cursor) args.cursor = cursor

    const raw = yield* client.callTool(ISSUE.LIST, args).pipe(
      Effect.catch((e: unknown) => {
        const msg = LinearMcpError.isInstance(e)
          ? String(e.data.message ?? "")
          : e instanceof Error
            ? e.message
            : String(e)
        return Effect.succeed({ _error: true, message: msg })
      }),
    )

    if (typeof raw === "object" && raw !== null && "_error" in raw) {
      const msg = String((raw as Record<string, unknown>).message ?? "unknown MCP error")
      errors.push({ linearIssueId: "<batch>", error: msg })
      break
    }

    const parsed = parseIssues(raw)
    for (const node of parsed.nodes) allIssues.push(node)

    const hasMore = !!(parsed.pageInfo?.hasNextPage && parsed.pageInfo?.endCursor)
    if (hasMore) cursor = parsed.pageInfo!.endCursor
    if (!hasMore) hasNextPage = false
  }

  // ADR-0002 D5 step 3: filter to the active set — only issues whose
  // `statusType` is `unstarted` or `started` are reconciled. Issues in
  // `completed`, `canceled`, or other state types (and issues that omit
  // `statusType` entirely) are dropped before the INSERT/SKIP/UPDATE logic.
  // Archived (soft-deleted) issues are also excluded so they don't get
  // re-inserted or updated.
  const activeIssues = allIssues.filter((node) => {
    const i = node as Record<string, unknown>
    if (isArchived(i)) return false
    const t = readStatusType(i)
    return t !== undefined && ACTIVE_STATES.has(t)
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
      skipped++
      continue
    }
    if (local.last_pulled_at !== undefined && local.last_pulled_at === cloudUpdatedAt) {
      skipped++
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
      skipped++
      continue
    }

    toUpdate.push({
      localId: local.id,
      linearIssueId: linearId,
      patch,
    })
  }

  // Phase 1: INSERT all L1 issues (no parent) first.
  yield* Effect.all(
    toInsertL1.map(({ linearIssueId, fields }) =>
      Effect.gen(function* () {
        const created = yield* issueSvc.create({ directory: input.directory, issue: fields }).pipe(
          Effect.catch((e: unknown) => {
            const msg = LinearMcpError.isInstance(e)
              ? String(e.data.message ?? "")
              : e instanceof Error
                ? e.message
                : String(e)
            return Effect.succeed({ _error: true, message: msg, issueId: linearIssueId })
          }),
        )

        if (typeof created === "object" && created !== null && "_error" in created) {
          const r = created as Record<string, unknown>
          errors.push({
            linearIssueId: (r.issueId as string) || linearIssueId,
            error: (r.message as string) || "unknown",
          })
          return
        }

        pulled++
        ids.push(linearIssueId)
      }),
    ),
    { concurrency: DEFAULT_BATCH, discard: true },
  )

  // After L1 inserts, rebuild the linked map so L2 inserts can resolve
  // their parent's local id via linear_issue_id.
  const linkedAfterL1 = yield* issueSvc.get({ directory: input.directory })
  const linkedMapAfterL1 = new Map<string, Issue.Info>()
  for (const i of linkedAfterL1) {
    if (i.linear_issue_id) linkedMapAfterL1.set(i.linear_issue_id, i)
  }

  // Phase 2: INSERT all L2 issues (with parent), now that parents exist locally.
  yield* Effect.all(
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
              Effect.catch((e: unknown) => {
                const msg = LinearMcpError.isInstance(e)
                  ? String(e.data.message ?? "")
                  : e instanceof Error
                    ? e.message
                    : String(e)
                return Effect.succeed({ _error: true, message: msg, issueId: linearIssueId })
              }),
            )
          if (typeof created === "object" && created !== null && "_error" in created) {
            const r = created as Record<string, unknown>
            errors.push({
              linearIssueId: (r.issueId as string) || linearIssueId,
              error: (r.message as string) || "unknown",
            })
            return
          }
          pulled++
          ids.push(linearIssueId)
          return
        }

        const created = yield* issueSvc
          .create({
            directory: input.directory,
            issue: { ...fields, level: 1, parent_id: parentLocal.id },
          })
          .pipe(
            Effect.catch((e: unknown) => {
              const msg = LinearMcpError.isInstance(e)
                ? String(e.data.message ?? "")
                : e instanceof Error
                  ? e.message
                  : String(e)
              return Effect.succeed({ _error: true, message: msg, issueId: linearIssueId })
            }),
          )

        if (typeof created === "object" && created !== null && "_error" in created) {
          const r = created as Record<string, unknown>
          errors.push({
            linearIssueId: (r.issueId as string) || linearIssueId,
            error: (r.message as string) || "unknown",
          })
          return
        }

        pulled++
        ids.push(linearIssueId)
      }),
    ),
    { concurrency: DEFAULT_BATCH, discard: true },
  )

  yield* Effect.all(
    toUpdate.map(({ localId, linearIssueId, patch }) =>
      Effect.gen(function* () {
        const result = yield* issueSvc.update({ directory: input.directory, id: localId, patch }).pipe(
          Effect.catch((e: unknown) => {
            const msg = LinearMcpError.isInstance(e)
              ? String(e.data.message ?? "")
              : e instanceof Error
                ? e.message
                : String(e)
            return Effect.succeed({ _error: true, message: msg, issueId: linearIssueId })
          }),
        )

        if (typeof result === "object" && result !== null && "_error" in result) {
          const r = result as Record<string, unknown>
          errors.push({
            linearIssueId: (r.issueId as string) || linearIssueId,
            error: (r.message as string) || "unknown",
          })
          return
        }

        updated++
      }),
    ),
    { concurrency: DEFAULT_BATCH, discard: true },
  )

  // Watermark-only refresh: content fields are identical, just sync the
  // `last_pulled_at` watermark and `cloud_shadow` so the next pull
  // doesn't see the same mismatch. These are already counted as skipped
  // in the loop above.
  yield* Effect.all(
    toWatermarkRefresh.map(({ localId, patch }) =>
      Effect.gen(function* () {
        yield* issueSvc.update({ directory: input.directory, id: localId, patch }).pipe(
          Effect.catch((e: unknown) => {
            // Swallow — watermark refresh is best-effort; a failure
            // here just means the next pull will try again.
            const msg = LinearMcpError.isInstance(e)
              ? String(e.data.message ?? "")
              : e instanceof Error
                ? e.message
                : String(e)
            return Effect.succeed({ _error: true, message: msg })
          }),
        )
      }),
    ),
    { concurrency: DEFAULT_BATCH, discard: true },
  )

  // Deletion sync: remove local issues whose `linear_issue_id` no longer
  // exists on Linear as an active (non-archived) issue. Linear's "delete"
  // is actually "archive" — `list_issues` returns archived issues with a
  // non-null `archivedAt`. We treat archived issues as deleted so the local
  // row is removed. Issues merely moved to a non-active state type (e.g.,
  // "completed") are NOT deleted — only archived or truly absent issues are.
  // This is skipped when the batch list_issues call failed, because a
  // partial cloud list would cause spurious local deletions.
  let deleted = 0
  const batchFailed = errors.some((e) => e.linearIssueId === "<batch>")
  if (!batchFailed) {
    const cloudActiveIds = new Set<string>()
    for (const node of allIssues) {
      const i = node as Record<string, unknown>
      if (isArchived(i)) continue
      const id = typeof i.id === "string" ? i.id : undefined
      if (id) cloudActiveIds.add(id)
    }
    const toDelete: Array<{ localId: string; linearIssueId: string }> = []
    for (const [linearIssueId, local] of linked) {
      if (!cloudActiveIds.has(linearIssueId)) {
        toDelete.push({ localId: local.id, linearIssueId })
      }
    }
    yield* Effect.all(
      toDelete.map(({ localId, linearIssueId }) =>
        Effect.gen(function* () {
          yield* issueSvc.delete({ directory: input.directory, id: localId }).pipe(
            Effect.catch((e: unknown) => {
              const msg = LinearMcpError.isInstance(e)
                ? String(e.data.message ?? "")
                : e instanceof Error
                  ? e.message
                  : String(e)
              errors.push({ linearIssueId, error: msg })
              return Effect.void
            }),
          )
          deleted++
        }),
      ),
      { concurrency: DEFAULT_BATCH, discard: true },
    )
  }

  return new Result({ pulled, skipped, updated, deleted, failed: errors.length, ids, errors })
})

export * as SyncPull from "./sync-pull"
