import { Context, Effect, Schema } from "effect"
import { ISSUE } from "./tool-names"
import { LinearMcpClient } from "./mcp-client"
import { Issue } from "./issue"
import { LinearBinding } from "@/issue/linear-binding"
import { Database } from "@opencode-ai/core/database/database"
import { eq, and } from "drizzle-orm"
import { IssueTable } from "./issue.sql"

/**
 * SyncPush — push local IssueTable changes back to Linear (ADR-0002 D8).
 *
 * Two cohorts:
 *   - Linked issues (have `linear_issue_id`): pre-verify via `get_issue`,
 *     then `save_issue` with `id` to UPDATE the remote. Skips rows whose
 *     `time_updated <= last_pushed_at` (no change since last push).
 *   - Local-only issues (no `linear_issue_id`): `save_issue` WITHOUT `id`
 *     to CREATE a new Linear issue. After success, the local row is
 *     patched with the returned `linear_issue_id` so future pushes update
 *     the same remote issue (no duplicates).
 *
 * Field names mirror the REAL Linear MCP `save_issue` inputSchema
 * (captured in `packages/opencode/.issue-probe-out.json`):
 *   `id` (update only), `title`, `description`, `team` (required on
 *   create), `project`, `state`, `priority`, `assignee`, `labels`,
 *   `dueDate`. Arguments are passed FLAT — not wrapped in `input` —
 *   consistent with `list_issues` and `get_issue` calls in SyncPull.
 *
 * Consistency hardening (G1): before each UPDATE `save_issue`, the issue
 * is pre-verified via `get_issue` to ensure the linked `linear_issue_id`
 * still exists on Linear and belongs to the configured project/team.
 * If the remote issue is missing or mismatched, the local row is marked
 * orphan (its `linear_issue_id` is cleared) and the issue is skipped —
 * preventing accidental duplicate creation. After `save_issue` returns,
 * the response issue id is asserted to equal the local `linear_issue_id`;
 * a mismatch is recorded as `duplicate_risk` and the push is treated as
 * failed for that row.
 *
 * On success, `last_pushed_at` is set to the same `Date.now()` stamp as
 * `time_updated` (via a single SQL UPDATE). This keeps the two columns
 * in lockstep, so a row that has not changed since the last push will
 * not be re-pushed on the next call (filter is `last_pushed_at <
 * time_updated`, which is false when they're equal).
 */
export namespace SyncPush {
  /**
   * Effect context tag for the Linear MCP client consumed by push().
   * Must be provided in the layer that calls push().
   */
  export const Client = Context.Service<LinearMcpClient>("@opencode/SyncPush/Client")

  /** Fatal error when push cannot proceed at all (e.g., missing config). */
  export class Error extends Schema.TaggedErrorClass<Error>()("SyncPushError", {
    message: Schema.String,
    issueID: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  }) {}

  /** Summary of a push operation. */
  export class Result extends Schema.Class<Result>("SyncPushResult")({
    /** Number of issues successfully pushed to Linear. */
    pushed: Schema.Number,
    /** Number of issues that failed to push. */
    failed: Schema.Number,
    /** Linear issue IDs that were updated by the push. */
    ids: Schema.Array(Schema.String),
    /** Per-issue error details for failed pushes. */
    errors: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        message: Schema.String,
      }),
    ),
  }) {}

  /** Maximum number of concurrent push operations. */
  export const DEFAULT_BATCH = 10

  /** Map an Issue.Priority to a Linear priority number (0=no priority, 1=urgent…4=low). */
  export const mapPriority = (p: Issue.Priority): 0 | 1 | 2 | 3 | 4 => {
    switch (p) {
      case "urgent":
        return 1
      case "high":
        return 2
      case "medium":
        return 3
      case "low":
        return 4
      default:
        return 0
    }
  }

  /**
   * Outcome of a single-issue pre-verification via `get_issue`.
   * - `ok`            → remote issue exists and matches the configured project/team
   * - `orphan`        → remote issue no longer exists (deleted on Linear)
   * - `mismatch`      → remote issue exists but belongs to a different project/team
   * - `lookup_failed` → `get_issue` itself errored (network / permission); push is skipped to be safe
   */
  export type VerifyOutcome = "ok" | "orphan" | "mismatch" | "lookup_failed"

  /**
   * Best-effort parse of a `get_issue` MCP response into the remote
   * issue's `id`, `projectId`, and `teamId`. Linear's MCP returns the
   * data nested under `content[0].text` as JSON. We accept both the
   * GraphQL-ish `{ data: { issue: { id, projectId, teamId } } }` shape
   * and a flat `{ id, projectId, teamId }` shape.
   */
  const parseGetIssueResponse = (raw: unknown): { id?: string; projectId?: string; teamId?: string } => {
    if (!raw || typeof raw !== "object") return {}
    const r = raw as Record<string, unknown>

    // Try { content: [{ type: "text", text: "<json>" }] }
    if (Array.isArray(r.content)) {
      for (const item of r.content) {
        if (typeof item !== "object" || !item) continue
        const c = item as Record<string, unknown>
        if (c.type === "text" && typeof c.text === "string") {
          try {
            const parsed = JSON.parse(c.text)
            if (parsed && typeof parsed === "object") {
              const p = parsed as Record<string, unknown>
              // Flat shape
              if (typeof p.id === "string") {
                return {
                  id: p.id,
                  projectId: typeof p.projectId === "string" ? p.projectId : undefined,
                  teamId: typeof p.teamId === "string" ? p.teamId : undefined,
                }
              }
              // GraphQL shape: { data: { issue: { id, projectId, teamId } } }
              const data = p.data
              if (data && typeof data === "object") {
                const d = data as Record<string, unknown>
                const issue = d.issue
                if (issue && typeof issue === "object") {
                  const i = issue as Record<string, unknown>
                  return {
                    id: typeof i.id === "string" ? i.id : undefined,
                    projectId: typeof i.projectId === "string" ? i.projectId : undefined,
                    teamId: typeof i.teamId === "string" ? i.teamId : undefined,
                  }
                }
              }
            }
          } catch {
            // not JSON — continue
          }
        }
      }
    }

    return {}
  }

  /**
   * Pre-verify that the linked Linear issue still exists and matches the
   * configured project/team. Returns a VerifyOutcome describing the
   * result. Never throws — a lookup error is reported as `lookup_failed`
   * so the caller can skip the push safely.
   */
  const verifyLinearIssue = Effect.fn("SyncPush.verifyLinearIssue")(function* (input: {
    linearId: string
    expectedProjectId: string | null | undefined
    expectedTeamId: string | null | undefined
  }) {
    const client = yield* Client
    const raw = yield* client
      .callTool(ISSUE.GET, { id: input.linearId })
      .pipe(Effect.catch((e: unknown) => Effect.succeed({ _verifyError: true, message: String(e) })))

    if (typeof raw === "object" && raw !== null && "_verifyError" in raw) {
      return "lookup_failed" as VerifyOutcome
    }

    const parsed = parseGetIssueResponse(raw)
    if (!parsed.id) {
      return "orphan" as VerifyOutcome
    }
    // Only compare fields that we have an expected value for. If
    // `expectedProjectId` is null (e.g., the issue was created via push
    // and the save_issue response didn't include projectId), skip the
    // project check — the team check is still enforced if available.
    if (
      (input.expectedProjectId && parsed.projectId && parsed.projectId !== input.expectedProjectId) ||
      (input.expectedTeamId && parsed.teamId && parsed.teamId !== input.expectedTeamId)
    ) {
      return "mismatch" as VerifyOutcome
    }
    return "ok" as VerifyOutcome
  })

  /**
   * Parse a `save_issue` MCP response and return the issue's `id`,
   * `projectId`, and `teamId`. Linear's MCP returns the data nested under
   * `content[0].text` as JSON. The `id` is the human-readable identifier
   * (e.g., "BOR-17"), while `projectId` and `teamId` are UUIDs.
   *
   * The UUIDs are extracted so that the CREATE path can store them in
   * `linear_project_id` / `linear_team_id` — NOT the config values, which
   * may be slugs (e.g., "graduationdesign-69b3bec34c5f") extracted from
   * the project URL. Storing the UUID ensures `verifyLinearIssue` can
   * correctly compare against the UUIDs returned by `get_issue`.
   */
  const parseSaveIssueResponse = (raw: unknown): { id: string; projectId?: string; teamId?: string } | undefined => {
    if (!raw || typeof raw !== "object") return
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
              // Flat shape: { id: "...", projectId: "...", teamId: "..." }
              if (typeof p.id === "string") {
                return {
                  id: p.id,
                  projectId: typeof p.projectId === "string" ? p.projectId : undefined,
                  teamId: typeof p.teamId === "string" ? p.teamId : undefined,
                }
              }
              // GraphQL shape: { data: { saveIssue: { id, projectId, teamId } } }
              const data = p.data
              if (data && typeof data === "object") {
                const d = data as Record<string, unknown>
                const saveIssue = d.saveIssue
                if (saveIssue && typeof saveIssue === "object") {
                  const s = saveIssue as Record<string, unknown>
                  if (typeof s.id === "string") {
                    return {
                      id: s.id,
                      projectId: typeof s.projectId === "string" ? s.projectId : undefined,
                      teamId: typeof s.teamId === "string" ? s.teamId : undefined,
                    }
                  }
                }
                // Some responses nest under `issue`
                const issue = d.issue
                if (issue && typeof issue === "object") {
                  const i = issue as Record<string, unknown>
                  if (typeof i.id === "string") {
                    return {
                      id: i.id,
                      projectId: typeof i.projectId === "string" ? i.projectId : undefined,
                      teamId: typeof i.teamId === "string" ? i.teamId : undefined,
                    }
                  }
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
   * Compare an issue's current local content fields against its
   * `cloud_shadow` snapshot and return the names of the fields that differ.
   * An empty result means the local row matches the last-known cloud state
   * (nothing to push for a field-level merge). Used by both `push` (batch)
   * and `pushOne`.
   */
  const diffShadow = (issue: Issue.Info, shadow: Record<string, unknown>): Issue.ShadowField[] => {
    const changed: Issue.ShadowField[] = []
    for (const f of Issue.SHADOW_FIELDS) {
      const local = issue[f]
      const cloud = shadow[f]
      // labels is an array — compare by JSON string to ignore order? No,
      // order matters for Linear (labels are a set, but we compare exactly).
      // Use JSON.stringify for deep equality across strings/arrays/null.
      if (JSON.stringify(local) !== JSON.stringify(cloud)) changed.push(f)
    }
    return changed
  }

  /**
   * Build `save_issue` arguments from ONLY the specified content fields.
   * Always includes `id`, `team`, `project` (required by Linear for UPDATE).
   * Content fields are mapped from Issue.Info to Linear's flat param names:
   *   title→title, description→description, status→state (direct passthrough — Linear accepts state name),
   *   priority→priority (via mapPriority), labels→labels, due_date→dueDate,
   *   assignee_id→assignee. `content` is not a Linear field (Linear has no
   *   "content" concept separate from title+description) so it is skipped.
   */
  const buildPartialSaveArgs = (
    issue: Issue.Info,
    fields: Issue.ShadowField[],
    linearId: string,
    teamId: string,
    projectId: string,
  ): Record<string, unknown> => {
    const args: Record<string, unknown> = { id: linearId, team: teamId, project: projectId }
    const fieldSet = new Set<string>(fields)
    if (fieldSet.has("title")) args.title = issue.title || issue.content || "Untitled"
    if (fieldSet.has("description")) args.description = issue.description || issue.content || ""
    if (fieldSet.has("status")) args.state = issue.status
    if (fieldSet.has("priority")) args.priority = mapPriority(issue.priority)
    if (fieldSet.has("labels") && issue.labels && issue.labels.length > 0) args.labels = issue.labels
    if (fieldSet.has("assignee_id") && issue.assignee_id) args.assignee = issue.assignee_id
    if (fieldSet.has("due_date") && issue.due_date) args.dueDate = issue.due_date
    return args
  }

  /**
   * Push workspace issues to Linear.
   *
   * Two paths:
   *   - Linked issues (have `linear_issue_id`): pre-verify via `get_issue`,
   *     then `save_issue` with `id` to UPDATE the remote. Uses field-level
   *     merge — only the content fields that differ from `cloud_shadow` are
   *     sent, preserving cloud-side edits to untouched fields. Rows whose
   *     shadow matches the local state are skipped (no spurious pushes).
   *   - Local-only issues (no `linear_issue_id`): `save_issue` WITHOUT `id`
   *     to CREATE a new Linear issue. After success, the local row is
   *     patched with the returned `linear_issue_id` so future pushes update
   *     the same remote issue (no duplicates).
   */
  export const push = Effect.fn("SyncPush.push")(function* (input: { directory: string; issueIds?: string[] | "all" }) {
    // ADR-0004: team/project binding is workspace-scoped, read from
    // LinearBinding.Service (<workspace>/.opencode/linear-binding.json),
    // NOT from the global Config.Linear which now only has syncMode/autoPush.
    const bindingSvc = yield* LinearBinding.Service
    const binding = yield* bindingSvc.get()

    if (!binding?.projectId || !binding?.teamId) {
      return yield* Effect.fail(new Error({ message: "Linear binding missing projectId or teamId" }))
    }
    const cfg = binding

    const issueSvc = yield* Issue.Service
    const { db } = yield* Database.Service
    const all = yield* issueSvc.get({ directory: input.directory })

    let issues: Issue.Info[]
    if (input.issueIds === "all" || !input.issueIds) {
      issues = all
    } else {
      const set = new Set(input.issueIds)
      issues = all.filter((i) => set.has(i.id))
    }

    // Split into two cohorts: linked (update) and local-only (create).
    const linked = issues.filter((i) => !!i.linear_issue_id)
    const localOnly = issues.filter((i) => !i.linear_issue_id)
    // Linked: only push rows whose content fields actually differ from the
    // last-known cloud snapshot. This is a field-level dirty check — it
    // catches changes that bump `time_updated` (user edits) AND changes
    // that don't (e.g., AutoProgress `patchStatus` only writes the
    // `status` column, leaving `time_updated` untouched but `cloud_shadow`
    // stale). The previous `last_pushed_at < time_updated` filter missed
    // the latter class, causing AutoProgress status changes to never
    // propagate via batch push. When the shadow matches the local state,
    // there is genuinely nothing to push — skip silently (no spurious
    // "pushed" count, no Linear API call that would bump `updatedAt` and
    // then trigger a spurious pull "updated" on the next sync).
    const linkedDirty = linked.filter((i) => {
      const shadow = i.cloud_shadow ?? null
      if (!shadow) return true // first sync after migration — push everything
      return diffShadow(i, shadow).length > 0
    })

    if (linkedDirty.length === 0 && localOnly.length === 0) {
      return new Result({ pushed: 0, failed: 0, ids: [], errors: [] })
    }

    const client = yield* Client
    const ids: string[] = []
    const errors: Array<{ id: string; message: string }> = []

    // Cohort 1: linked issues (UPDATE path, field-level merge).
    yield* Effect.all(
      linkedDirty.map((issue) =>
        Effect.gen(function* () {
          const linearId = issue.linear_issue_id!
          // For verification, use the stored UUID (from pull or CREATE
          // response). Do NOT fall back to cfg.projectId — that may be a
          // slug extracted from the project URL, which will never match
          // the UUID returned by get_issue.
          const verifyProjectId = issue.linear_project_id
          const verifyTeamId = issue.linear_team_id

          // G1 hardening: pre-verify the linked Linear issue still exists
          // and belongs to the configured project/team. If not, clear the
          // local `linear_issue_id` (orphan) and skip — never silently
          // create a new issue on Linear.
          const outcome = yield* verifyLinearIssue({
            linearId,
            expectedProjectId: verifyProjectId,
            expectedTeamId: verifyTeamId,
          })

          if (outcome === "orphan") {
            yield* db
              .update(IssueTable)
              .set({ linear_issue_id: null, last_pushed_at: null })
              .where(and(eq(IssueTable.directory, input.directory), eq(IssueTable.id, issue.id)))
              .run()
              .pipe(Effect.orDie)
            errors.push({
              id: issue.id,
              message: `orphan: Linear issue ${linearId} no longer exists; local link cleared`,
            })
            return
          }
          if (outcome === "mismatch") {
            errors.push({
              id: issue.id,
              message: `mismatch: Linear issue ${linearId} belongs to a different project/team`,
            })
            return
          }
          if (outcome === "lookup_failed") {
            errors.push({
              id: issue.id,
              message: `lookup_failed: could not verify Linear issue ${linearId}; push skipped`,
            })
            return
          }

          // Field-level merge: only send the content fields that actually
          // differ from `cloud_shadow`. This preserves cloud-side edits to
          // untouched fields (e.g., a teammate edited the description on
          // linear.app while we only changed status locally). When no
          // shadow exists (first sync after migration), send all fields.
          const shadow = issue.cloud_shadow ?? null
          const dirtyFields = shadow ? diffShadow(issue, shadow) : [...Issue.SHADOW_FIELDS]
          if (dirtyFields.length === 0) {
            // Race: shadow caught up between the filter above and now.
            // Nothing to push.
            return
          }
          const saveArgs = buildPartialSaveArgs(issue, dirtyFields, linearId, cfg.teamId!, cfg.projectId!)

          const raw = yield* client
            .callTool(ISSUE.SAVE, saveArgs)
            .pipe(Effect.catch((e: unknown) => Effect.succeed({ _error: true, message: String(e) })))

          if (typeof raw === "object" && raw !== null && "_error" in raw) {
            const msg = String((raw as Record<string, unknown>).message ?? "unknown MCP error")
            errors.push({ id: issue.id, message: msg })
            return
          }

          // G1 hardening: assert the save_issue response id matches the
          // local linear_issue_id. A mismatch means Linear created a new
          // issue instead of updating — treat as duplicate_risk and do
          // NOT advance last_pushed_at (so the user can investigate).
          const responseId = parseSaveIssueResponse(raw)?.id
          if (responseId && responseId !== linearId) {
            errors.push({
              id: issue.id,
              message: `duplicate_risk: save_issue returned id ${responseId} but expected ${linearId}; push rolled back`,
            })
            return
          }

          const stamp = Date.now()
          yield* db
            .update(IssueTable)
            .set({
              last_pushed_at: stamp,
              time_updated: stamp,
              linear_updated_at: stamp,
              cloud_shadow: JSON.stringify(Issue.buildShadow(issue)),
            })
            .where(and(eq(IssueTable.directory, input.directory), eq(IssueTable.id, issue.id)))
            .run()
            .pipe(Effect.orDie)

          ids.push(linearId)
        }),
      ),
      { concurrency: DEFAULT_BATCH, discard: true },
    )

    // Cohort 2: local-only issues (CREATE path). Call save_issue WITHOUT
    // issueId to create a new Linear issue. On success, patch the local row
    // with the returned `linear_issue_id` so future pushes update it.
    yield* Effect.all(
      localOnly.map((issue) =>
        Effect.gen(function* () {
          // CREATE path: no `id` field (Linear creates a new issue).
          // Same flat-args + correct field names as the UPDATE path above.
          // `title` and `team` are required by Linear for CREATE.
          // `state` is the Linear workflow state name (e.g., "Backlog"),
          // passed directly — Linear's save_issue accepts state name, type, or ID.
          const saveArgs: Record<string, unknown> = {
            title: issue.title || issue.content || "Untitled",
            description: issue.description || issue.content || "",
            priority: mapPriority(issue.priority),
            state: issue.status,
            team: cfg.teamId!,
            project: cfg.projectId!,
            ...(issue.labels && issue.labels.length > 0 ? { labels: issue.labels } : {}),
            ...(issue.assignee_id ? { assignee: issue.assignee_id } : {}),
            ...(issue.due_date ? { dueDate: issue.due_date } : {}),
          }

          const raw = yield* client
            .callTool(ISSUE.SAVE, saveArgs)
            .pipe(Effect.catch((e: unknown) => Effect.succeed({ _error: true, message: String(e) })))

          if (typeof raw === "object" && raw !== null && "_error" in raw) {
            const msg = String((raw as Record<string, unknown>).message ?? "unknown MCP error")
            errors.push({ id: issue.id, message: msg })
            return
          }

          const parsed = parseSaveIssueResponse(raw)
          if (!parsed) {
            errors.push({
              id: issue.id,
              message: "create_failed: save_issue did not return an id for the new issue",
            })
            return
          }

          // Patch the local row with the new linear_issue_id and advance
          // last_pushed_at so future pushes treat it as up-to-date. Use the
          // Issue.Service (not a raw DB write) so an `issue.updated` bus
          // event fires and the desktop UI refreshes to show the new link.
          //
          // Store the projectId/teamId UUIDs from the Linear response — NOT
          // the config values, which may be slugs (e.g.
          // "graduationdesign-69b3bec34c5f") extracted from the project URL.
          // The UUIDs are needed for verifyLinearIssue to correctly compare
          // against get_issue's projectId/teamId on subsequent pushes.
          const stamp = Date.now()
          yield* issueSvc.update({
            directory: input.directory,
            id: issue.id,
            patch: {
              linear_issue_id: parsed.id,
              linear_team_id: parsed.teamId ?? cfg.teamId!,
              linear_project_id: parsed.projectId ?? null,
              last_pushed_at: stamp,
              time_updated: stamp,
              // Seed the pull watermark so the first pull after CREATE
              // doesn't immediately re-reconcile (Linear bumped updatedAt
              // when it created the issue).
              linear_updated_at: stamp,
              cloud_shadow: Issue.buildShadow(issue),
            },
          })

          ids.push(parsed.id)
        }),
      ),
      { concurrency: DEFAULT_BATCH, discard: true },
    )

    return new Result({
      pushed: ids.length,
      failed: errors.length,
      ids,
      errors,
    })
  })
}
