import { Context, Effect, Schema } from "effect"
import { ISSUE } from "./tool-names"
import { LinearMcpClient } from "./mcp-client"
import { LinearMcpError } from "./mcp-client"
import { Issue } from "./issue"
import { LinearBinding } from "@/issue/linear-binding"

/**
 * SyncPull — snapshot-import Linear issues into the local IssueTable
 * (workspace-scoped, per ADR-0001 D1, ADR-0002 D5–D7).
 *
 * `pull({ directory })` fetches Linear issues for the configured
 * project and reconciles them into the local IssueTable:
 *
 * - Linear issues with no local `linear_issue_id` link → INSERT new row.
 * - Linked issues whose stored `linear_updated_at` matches the cloud
 *   `updatedAt` → SKIP (truly unchanged).
 * - Linked issues whose `linear_updated_at` differs (or is null) →
 *   UPDATE local fields from the cloud (cloud-wins for Linear-sourced
 *   fields). This is the reconcile path added 2026-07-09, amending
 *   ADR-0002 D5 — cloud-side edits to a Linear issue now flow down on
 *   pull instead of being silently skipped.
 *
 * Local-only issues (no `linear_issue_id`) are never touched by a pull.
 * The pull does not skip on "nothing to do" — it always runs and
 * returns honest counts (ADR-0002 D6).
 */
export namespace SyncPull {
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

  const safeParse = (text: string): unknown => {
    try {
      return JSON.parse(text)
    } catch {
      return
    }
  }

  // The REAL Linear MCP `list_issues` returns `content[0].text` decoding to a
  // flat top-level object: `{ issues: [...], hasNextPage: boolean }`. There is
  // NO `data` wrapper and NO `nodes`/`pageInfo` nesting. We still accept the
  // legacy `{ data: { issues: { nodes, pageInfo } } }` shape defensively, but
  // the real shape is the only one the live server produces (verified via
  // `script/issue-linear-probe.ts`, captured in
  // `__fixtures__/linear-list-issues-real.json`).
  const parseIssues = (
    raw: unknown,
  ): { nodes: unknown[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string } } => {
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
   * to Unix ms for storage in `IssueTable.linear_updated_at`. Used as the
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
   * a non-null `archivedAt` timestamp. Used by `pullOne` to detect
   * archived cloud issues and skip them (the local row is NOT removed —
   * ADR-0002 D6 defers deletion to a follow-up ADR).
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
      linear_updated_at: updatedAtMs ?? null,
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
          try {
            const parsed = JSON.parse(c.text)
            if (parsed && typeof parsed === "object") {
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
          } catch {
            // not JSON — continue
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
   *   - Linked and stored `linear_updated_at` === cloud `updatedAt` → SKIP.
   *   - Linked and `linear_updated_at` differs (or is null) → UPDATE local
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
    // detect "already linked" and read the stored `linear_updated_at` watermark
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

      if (parsed.pageInfo?.hasNextPage && parsed.pageInfo?.endCursor) {
        cursor = parsed.pageInfo.endCursor
      } else {
        hasNextPage = false
      }
    }

    // ADR-0002 D5 step 3: filter to the active set — only issues whose
    // `statusType` is `unstarted` or `started` are reconciled. Issues in
    // `completed`, `canceled`, or other state types (and issues that omit
    // `statusType` entirely) are dropped before the INSERT/SKIP/UPDATE logic.
    const activeIssues = allIssues.filter((node) => {
      const i = node as Record<string, unknown>
      const t = readStatusType(i)
      return t !== undefined && ACTIVE_STATES.has(t)
    })

    const toInsert: Array<{ linearIssueId: string; fields: Partial<Issue.Info> }> = []
    const toUpdate: Array<{ localId: string; linearIssueId: string; patch: Partial<Issue.Info> }> = []
    // Issues whose watermark moved but content fields are identical — refresh
    // only `linear_updated_at` and `cloud_shadow`, counted as skipped.
    const toWatermarkRefresh: Array<{ localId: string; patch: Partial<Issue.Info> }> = []

    for (const issue of activeIssues) {
      const i = issue as Record<string, unknown>
      const linearId = typeof i.id === "string" ? i.id : undefined
      if (!linearId) continue

      const local = linked.get(linearId)
      if (!local) {
        // Not linked locally → INSERT (with level: 0 for a fresh L1 row).
        toInsert.push({
          linearIssueId: linearId,
          fields: { ...mapLinearFields(i, linearId, cfg), level: 0 },
        })
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
      if (local.linear_updated_at !== undefined && local.linear_updated_at === cloudUpdatedAt) {
        skipped++
        continue
      }

      // Cloud moved (or local watermark is null on the first post-migration
      // pull) → reconcile: overwrite the Linear-sourced fields from cloud.
      // Per ADR-0002 D5 (revised), cloud-wins for Linear-sourced fields.
      // `last_pushed_at`, `position`, `parent_id`, `level` are preserved
      // because they are not in the patch. Status is taken verbatim from
      // the cloud (no mapping needed).
      const patch = mapLinearFields(i, linearId, cfg)

      // Content-equivalence check: if all Linear-sourced content fields in
      // the patch match the local row's current values, the only thing that
      // changed is the `updatedAt` watermark (e.g., Linear bumped it because
      // we just pushed, or a non-content field like a comment was added).
      // In that case, refresh the watermark + shadow but count as skipped —
      // don't report a spurious "updated" to the user.
      const contentChanged = Issue.SHADOW_FIELDS.some((f) => {
        const localVal = local[f]
        const cloudVal = patch[f]
        return JSON.stringify(localVal) !== JSON.stringify(cloudVal)
      })
      if (!contentChanged) {
        toWatermarkRefresh.push({
          localId: local.id,
          patch: {
            linear_updated_at: patch.linear_updated_at,
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

    yield* Effect.all(
      toInsert.map(({ linearIssueId, fields }) =>
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
    // `linear_updated_at` watermark and `cloud_shadow` so the next pull
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

    return new Result({ pulled, skipped, updated, failed: errors.length, ids, errors })
  })
}
