import { Effect, Schema, Option } from "effect"
import { LinearGraphqlClient } from "./linear-graphql"
import { ISSUE } from "./tool-names"
import { LinearClientRef, LinearMcpError } from "./mcp-client"
import { Issue } from "./issue"
import { LinearBinding } from "@/issue/linear-binding"
import { Database } from "@opencode-ai/core/database/database"
import { eq, and } from "drizzle-orm"
import { IssueTable } from "./issue.sql"

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

// NOTE on `as Record<string, unknown>` assertions in this file:
// Same rationale as `sync-pull.ts`: the Linear MCP server returns untyped
// JSON via `Client.callTool` (MCP SDK types the wire as `CallToolResult`,
// our wrapper unwraps to `unknown`). The Linear MCP wraps GraphQL responses
// inside `{ content: [{ type: "text", text: "<json>" }] }`. We `decodeJson`
// the inner text payload, then structurally narrow with
// `as Record<string, unknown>` to navigate the envelope. Schema validation
// is applied at field-extraction boundaries (e.g. `decodeIssueUpdate`,
// `decodeGetIssue`, `decodeSaveIssue`); the outer envelope is structurally
// asserted because the MCP transport is the trust boundary, not the local
// type system — wrapping every navigation step in Schema would double the
// code size without catching additional bugs.
/**
 * Schema for the `issueUpdate` payload returned by Linear GraphQL. Used to
 * validate the untyped `unknown` returned by `LinearGraphqlClient.call`
 * before reading the `success` flag (per AGENTS.md: prefer Schema over
 * `as` casts for untrusted JSON).
 */
const IssueUpdatePayload = Schema.Struct({
  issueUpdate: Schema.optional(Schema.Struct({ success: Schema.Boolean })),
})
const decodeIssueUpdate = Schema.decodeUnknownOption(IssueUpdatePayload)

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
 * On success, `last_pushed_at` is advanced to `Date.now()`. The push
 * does NOT bump `time_updated` — that column tracks local edits only
 * (ADR-0002 §D5/D8); bumping it on push would mask subsequent local
 * dirty checks. Dirty detection for batch push uses the `cloud_shadow`
 * diff (not `last_pushed_at < time_updated`), so a row whose shadow
 * matches the local state is skipped on the next push.
 *
 * The Linear MCP client is resolved per-request by
 * `LinearClientMiddleware` (HTTP path) or provided by the caller
 * (agent path) and consumed via the `LinearClientRef` context tag.
 */

/** Fatal error when push cannot proceed at all (e.g., missing config). */
export class SyncPushError extends Schema.TaggedErrorClass<SyncPushError>()("SyncPushError", {
  message: Schema.String,
  issueID: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {}

/**
 * Domain-level Error union for the SyncPush service (per AGENTS.md [E9]).
 * `SyncPushError` is for fatal preconditions (missing Linear binding,
 * MCP transport failure) that abort the entire push. Per-row failures
 * are returned in `Result.failed` as counts, not in this union.
 * `LinearMcpError` is intentionally NOT in this union — it is caught
 * at the call site (MCP tool call) and translated into a per-row
 * failure in `Result.errors`, never propagated as the push's own error.
 */
export type Error = SyncPushError

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

/** Extract issue id/projectId/teamId from a single MCP content item. */
const extractGetIssueFromItem = (item: unknown): { id?: string; projectId?: string; teamId?: string } | undefined => {
  if (typeof item !== "object" || !item) return undefined
  const c = item as Record<string, unknown>
  if (c.type !== "text" || typeof c.text !== "string") return undefined
  const parsed = Option.getOrUndefined(decodeJson(c.text))
  if (!parsed || typeof parsed !== "object") return undefined
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
  return undefined
}

/** Extract issue id/projectId/teamId from a `save_issue` MCP content item. */
const extractSaveIssueFromItem = (item: unknown): { id: string; projectId?: string; teamId?: string } | undefined => {
  if (typeof item !== "object" || !item) return undefined
  const c = item as Record<string, unknown>
  if (c.type !== "text" || typeof c.text !== "string") return undefined
  const parsed = Option.getOrUndefined(decodeJson(c.text))
  if (!parsed || typeof parsed !== "object") return undefined
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
  return undefined
}

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

  if (Array.isArray(r.content)) {
    const extracted = r.content
      .map(extractGetIssueFromItem)
      .find((x): x is { id?: string; projectId?: string; teamId?: string } => x !== undefined)
    if (extracted) return extracted
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
  const client = yield* LinearClientRef
  if (!client) return "lookup_failed" as VerifyOutcome
  const raw = yield* client.callTool(ISSUE.GET, { id: input.linearId }).pipe(
    // Catch only the expected LinearMcpError; let Interrupt/Die defects
    // propagate (per packages/core/src/tool/AGENTS.md). A lookup failure
    // is reported as `_verifyError` so the caller can skip the push.
    Effect.catchTag("LinearMcpError", (e) => Effect.succeed({ _verifyError: true, message: e.message })),
  )

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
    const extracted = r.content
      .map(extractSaveIssueFromItem)
      .find((x): x is { id: string; projectId?: string; teamId?: string } => x !== undefined)
    if (extracted) return extracted
  }
  return undefined
}

/**
 * Detect MCP-level errors. The MCP SDK does NOT reject on validation
 * errors — it returns a CallToolResult with `isError: true` and the
 * error message in `content[0].text`. The push path's `.catch` wrapper
 * only catches promise rejections, so MCP validation errors would be
 * silently treated as success.
 */
const mcpErrorMessage = (raw: unknown): string | undefined => {
  if (!raw || typeof raw !== "object") return
  const r = raw as Record<string, unknown>
  if (r.isError !== true) return
  if (Array.isArray(r.content)) {
    const textItem = r.content.find(
      (item): item is { text: string } =>
        typeof item === "object" &&
        item !== null &&
        (item as Record<string, unknown>).type === "text" &&
        typeof (item as Record<string, unknown>).text === "string",
    )
    if (textItem) return textItem.text
  }
  return "MCP error (no message)"
}

/**
 * Clear the `dueDate` field on a Linear issue via a direct GraphQL
 * mutation. The Linear MCP `save_issue` tool's inputSchema declares
 * `dueDate` as a pure `string` (no `null` in `anyOf`), so passing
 * `dueDate: null` is rejected by MCP-level Zod validation, and
 * `dueDate: ""` is silently ignored by Linear. The underlying Linear
 * GraphQL `issueUpdate` mutation DOES accept `dueDate: null` to clear
 * the field, so we call it directly when the local `due_date` has been
 * cleared.
 *
 * Per ADR-0005 D4, this GraphQL bypass is the shared foundation for
 * both user-side sync (this function) and the agent-side
 * `linear_graphql` tool — both call `LinearGraphqlClient.Service.call`.
 *
 * Returns true on success, false on failure (error message in `errors`).
 */
const clearDueDateViaGraphQL = Effect.fn("SyncPush.clearDueDateViaGraphQL")(function* (input: { linearId: string }) {
  // Thin wrapper over LinearGraphqlClient (ADR-0005 D7 Phase 0 step 2).
  // The mutation + variables construction stays here so the shared service
  // remains payload-agnostic; only the HTTP transport moved to the service.
  const mutation = `mutation($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue { id dueDate }
      }
    }`
  const variables = { id: input.linearId, input: { dueDate: null } }

  const graphql = yield* LinearGraphqlClient.Service
  const result = yield* graphql.call(mutation, variables)

  const data = Option.getOrUndefined(decodeIssueUpdate(result))
  if (!data?.issueUpdate?.success) {
    return yield* new LinearMcpError({ message: `GraphQL clearDueDate did not succeed for ${input.linearId}` })
  }
})

/**
 * Clear the Linear-side `parentId` for an issue via a direct GraphQL
 * mutation. Used when an L2 issue is converted to L1 locally (level: 0,
 * parent_id: null) — Linear MCP `save_issue` declares `parentId` as a
 * pure `string` (no `null` in anyOf), so passing `parentId: null` is
 * rejected at MCP-level Zod validation, and `parentId: ""` is silently
 * ignored. The underlying Linear GraphQL `issueUpdate` mutation DOES
 * accept `parentId: null` to remove the parent link.
 *
 * Same pattern as `clearDueDateViaGraphQL` (ADR-0005 D4 GraphQL bypass
 * for null-field clearing). Returns nothing on success, fails with
 * `LinearMcpError` on failure (caller catches and records to `errors`).
 */
const clearParentIdViaGraphQL = Effect.fn("SyncPush.clearParentIdViaGraphQL")(function* (input: { linearId: string }) {
  // Linear GraphQL `Issue` type has `parent: Issue` (nullable), not `parentId`.
  // `IssueUpdateInput` accepts `parentId: String` (nullable) to set/clear.
  // Query only `id` on return — we don't need to verify the cleared parent,
  // `success: true` is sufficient.
  const mutation = `mutation($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue { id }
      }
    }`
  const variables = { id: input.linearId, input: { parentId: null } }

  const graphql = yield* LinearGraphqlClient.Service
  const result = yield* graphql.call(mutation, variables)

  const data = Option.getOrUndefined(decodeIssueUpdate(result))
  if (!data?.issueUpdate?.success) {
    return yield* new LinearMcpError({ message: `GraphQL clearParentId did not succeed for ${input.linearId}` })
  }
})

/**
 * Compare an issue's current local content fields against its
 * `cloud_shadow` snapshot and return the names of the fields that differ.
 * An empty result means the local row matches the last-known cloud state
 * (nothing to push for a field-level merge). Used by the `push` batch
 * path; the previous `pushOne` single-row entry point was folded into
 * `push({ issueIds: [id] })` (ADR-0002 D8-revised).
 */
const diffShadow = (issue: Issue.Info, shadow: Record<string, unknown>): Issue.ShadowField[] => {
  // labels is an array — compare by JSON string to ignore order? No,
  // order matters for Linear (labels are a set, but we compare exactly).
  // Use JSON.stringify for deep equality across strings/arrays/null.
  return Issue.SHADOW_FIELDS.filter((f) => JSON.stringify(issue[f]) !== JSON.stringify(shadow[f]))
}

/**
 * Resolve the Linear-side parent identifier for an issue.
 *
 * For L1 issues (level 0, no parent): returns null (no parent on Linear).
 * For L2 issues (level 1, has parent): returns the parent's
 * `linear_issue_id` (e.g., "BOR-40"), or null if the parent is not
 * linked to Linear.
 *
 * This is the value that gets sent as `parentId` to Linear's save_issue
 * and stored in `cloud_shadow.linear_parent_id` for dirty-checking.
 *
 * Why a derived field and not a direct Issue.Info column: the local
 * `parent_id` is a kernel-generated UUID that means nothing to Linear.
 * Linear's `parentId` is an issue identifier (e.g., "BOR-40"). They are
 * not directly comparable. Instead, we resolve the parent's
 * `linear_issue_id` at push time and compare THAT against the last-known
 * cloud state. This lets us detect:
 *   - L2 whose parent was just linked (shadow has no linear_parent_id)
 *   - L2 that was reparented locally (parent's linear_issue_id changed)
 *   - L2 whose parent link is already synced (no-op, skip push)
 */
const resolveLinearParentId = (issue: Issue.Info, all: Issue.Info[]): string | null => {
  if (issue.level !== 1 || !issue.parent_id) return null
  const parent = all.find((i) => i.id === issue.parent_id)
  return parent?.linear_issue_id ?? null
}

/**
 * Build a cloud_shadow snapshot that includes both the content fields
 * (SHADOW_FIELDS) and the derived `linear_parent_id` for parent-link
 * dirty-checking. This is the shadow written to the DB after a push
 * so the next push can detect parent-link changes.
 *
 * `linear_parent_id` is NOT in SHADOW_FIELDS because it's not a direct
 * Issue.Info field — it's derived from the parent's linear_issue_id.
 * Including it in the shadow JSON (a text column) is backwards-
 * compatible: old shadows without this field are treated as
 * `undefined !== current_value` → dirty on the next push, which is
 * correct (we'd rather re-send parentId idempotently than miss a link).
 */
const buildShadowWithParent = (issue: Issue.Info, all: Issue.Info[]): Record<string, unknown> => {
  return {
    ...Issue.buildShadow(issue),
    linear_parent_id: resolveLinearParentId(issue, all),
  }
}

/**
 * Check if an issue's parent link is dirty relative to its cloud_shadow.
 * Returns true if the issue is an L2 with a linked parent whose
 * linear_issue_id differs from `cloud_shadow.linear_parent_id`.
 *
 * Old shadows (pre-fix) lack `linear_parent_id`, so `shadow.linear_parent_id`
 * is `undefined`. If the current resolved value is a string (parent linked),
 * `undefined !== "BOR-40"` → dirty. This ensures L2 issues pushed before
 * this fix get their parent link synced on the next push.
 */
const isParentLinkDirty = (issue: Issue.Info, shadow: Record<string, unknown> | null, all: Issue.Info[]): boolean => {
  if (issue.level !== 1 || !issue.parent_id) return false
  const current = resolveLinearParentId(issue, all)
  if (current === null) return false // parent not linked — nothing to sync
  const shadowed = shadow ? shadow.linear_parent_id : undefined
  return shadowed !== current
}

/**
 * Check if an issue was previously an L2 (had a Linear parent link) but
 * is now an L1 (parent_id: null) — i.e., the parent link has been
 * removed locally and must be cleared on Linear.
 *
 * Why a separate check from `isParentLinkDirty`: `isParentLinkDirty`
 * short-circuits when the issue has no parent_id and returns false. But
 * an L2→L1 conversion is exactly the case where we need to clear the
 * Linear parent link — Linear MCP `save_issue` rejects `parentId: null`
 * (Zod schema declares it as pure `string`), so we must dispatch a
 * GraphQL mutation to remove the link.
 *
 * Detection: the issue currently has NO parent_id (regardless of level
 * — level field may be stale or inconsistent), but
 * `cloud_shadow.linear_parent_id` is a non-empty string (the
 * previously-synced parent identifier).
 *
 * Why we check `parent_id` instead of `level`: the `level` field is
 * a denormalized hint that can drift (e.g., sync-pull may set level
 * differently than the local create path). The authoritative signal
 * for "is this issue a child?" is `parent_id`. Using `parent_id` avoids
 * false positives when level is 0 but parent_id is set (data
 * inconsistency) or level is 1 but parent_id is null (L2→L1 conversion
 * where level wasn't updated).
 */
const isParentLinkCleared = (issue: Issue.Info, shadow: Record<string, unknown> | null): boolean => {
  // If the issue currently has a parent_id, it's still an L2 — not a
  // clear. This covers L2 reparent (parent_id changed to a new L1) and
  // normal L2 (parent_id unchanged). Only issues WITHOUT a parent_id
  // can be "cleared" (L2→L1 conversion).
  if (issue.parent_id) return false
  if (!shadow) return false // no prior sync — nothing to clear
  const shadowed = shadow.linear_parent_id
  return typeof shadowed === "string" && shadowed.length > 0
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
  // Always send labels/assignee when dirty — Linear MCP accepts null/[] to
  // clear these (their schemas declare anyOf [string, null]).
  if (fieldSet.has("labels")) args.labels = issue.labels ?? []
  if (fieldSet.has("assignee_id")) args.assignee = issue.assignee_id ?? null
  // dueDate is special: Linear MCP save_issue declares it as a pure string
  // (no null in anyOf), so null is rejected by Zod and "" is silently
  // ignored. When the local due_date is cleared (null/empty), we omit it
  // from the MCP call and clear it via a direct GraphQL mutation instead
  // (see clearDueDateViaGraphQL). When it has a value, send it normally.
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
    return yield* new SyncPushError({ message: "Linear binding missing projectId or teamId" })
  }
  const cfg = binding

  const issueSvc = yield* Issue.Service
  const database = yield* Database.Service
  const db = database.db
  // Load with include_archived=true so that issues archived locally
  // (status ∈ {Done, Canceled, Duplicate}) are still pushed to Linear.
  // Their status field is part of SHADOW_FIELDS, so the field-level diff
  // will detect the change and `save_issue` will sync the new workflow
  // state to Linear. Without this, archiving an issue locally would make
  // it invisible to push (silently skipped) — the user's "Push" click
  // would do nothing for that issue.
  const all = yield* issueSvc.get({ directory: input.directory, include_archived: true })

  // ADR-0005 D3: `issueIds: []` means "bulk push" (no filter), NOT "push
  // zero issues". The three "no filter" shapes are: `"all"`, `undefined`,
  // and `[]` (empty array). Any non-empty array is a targeted push filter.
  const issueIdSet =
    input.issueIds === "all" || !input.issueIds || input.issueIds.length === 0
      ? null
      : new Set(input.issueIds)
  const issues = issueIdSet ? all.filter((i) => issueIdSet.has(i.id)) : all

  // Split into two cohorts: linked (update) and local-only (create).
  const linked = issues.filter((i) => !!i.linear_issue_id)
  const localOnly = issues.filter((i) => !i.linear_issue_id)
  // Linked: only push rows whose content fields actually differ from the
  // last-known cloud snapshot. This is a field-level dirty check — it
  // catches all content changes regardless of whether they bump
  // `time_updated` (e.g., user edits) or not. The previous
  // `last_pushed_at < time_updated` filter missed status-only writes
  // that left `time_updated` untouched, causing status changes to never
  // propagate via batch push. When the shadow matches the local state,
  // there is genuinely nothing to push — skip silently (no spurious
  // "pushed" count, no Linear API call that would bump `updatedAt` and
  // then trigger a spurious pull "updated" on the next sync).
  const linkedDirty = linked.filter((i) => {
    const shadow = i.cloud_shadow ?? null
    if (!shadow) return true // first sync after migration — push everything
    // Content dirty check (SHADOW_FIELDS) OR parent-link dirty check
    // (either L2 parent changed, or L2→L1 conversion requires clearing
    // the Linear parent link via GraphQL — MCP `save_issue` rejects null).
    return (
      diffShadow(i, shadow).length > 0 ||
      isParentLinkDirty(i, shadow, all) ||
      isParentLinkCleared(i, shadow)
    )
  })

  if (linkedDirty.length === 0 && localOnly.length === 0) {
    return new Result({ pushed: 0, failed: 0, ids: [], errors: [] })
  }

  const client = yield* LinearClientRef
  if (!client) {
    return yield* new SyncPushError({ message: "Linear client not available" })
  }
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
        // Parent-link dirty check: if the L2's parent link has changed
        // (or was never synced), we must push even if no content fields
        // are dirty. This handles the migration case where L2 issues were
        // pushed before the parentId fix — they're linked but have no
        // parent-child relationship on Linear.
        const parentDirty = isParentLinkDirty(issue, shadow, all)
        // L2→L1 conversion: previously an L2 with a Linear parent link,
        // now an L1 (parent_id null). The Linear-side parentId must be
        // cleared via GraphQL (MCP save_issue rejects null). Triggers a
        // push even if no content fields are dirty — the parent clear is
        // itself the change.
        const parentCleared = isParentLinkCleared(issue, shadow)
        if (dirtyFields.length === 0 && !parentDirty && !parentCleared) {
          // Race: shadow caught up between the filter above and now.
          // Nothing to push.
          return
        }

        // Build save_args. If only the parent link is dirty (no content
        // fields), send an UPDATE with just `id`/`team`/`project`/
        // `parentId` — no content fields. Linear treats this as a partial
        // update (only parentId changes, other fields untouched).
        //
        // When parentCleared is true (L2→L1), we DO NOT set parentId here
        // — save_issue can't clear it. The clear happens via GraphQL
        // below, after the save_issue call (if any) succeeds.
        const saveArgs =
          dirtyFields.length > 0
            ? buildPartialSaveArgs(issue, dirtyFields, linearId, cfg.teamId!, cfg.projectId!)
            : { id: linearId, team: cfg.teamId!, project: cfg.projectId! }

        // L2 issues: attach `parentId` (resolved from the parent's
        // linear_issue_id) so reparenting and initial parent linking sync
        // to Linear. `parent_id` is not in SHADOW_FIELDS (it's a local UUID,
        // not comparable to Linear's identifier-format parentId), so we
        // send it whenever the L2 has a linked parent — idempotent on
        // Linear's side (setting the same parentId is a no-op). If the
        // parent is not linked (no linear_issue_id), parentId is omitted;
        // the Linear issue remains a top-level issue until the parent is
        // pushed.
        if (issue.level === 1 && issue.parent_id) {
          const parentLinearId = resolveLinearParentId(issue, all)
          if (parentLinearId) {
            saveArgs.parentId = parentLinearId
          }
        }

        const raw = yield* client.callTool(ISSUE.SAVE, saveArgs).pipe(
          // Catch only LinearMcpError; defects propagate (AGENTS.md).
          Effect.catchTag("LinearMcpError", (e) => Effect.succeed({ _error: true, message: e.message })),
        )

        if (typeof raw === "object" && raw !== null && "_error" in raw) {
          const msg = String((raw as Record<string, unknown>).message ?? "unknown MCP error")
          errors.push({ id: issue.id, message: msg })
          return
        }

        // Detect MCP-level validation errors (isError: true). The MCP SDK
        // does NOT reject on these — they come back as a normal response
        // with the error in content[0].text.
        const mcpErr = mcpErrorMessage(raw)
        if (mcpErr) {
          errors.push({ id: issue.id, message: `MCP: ${mcpErr}` })
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

        // If due_date is in the dirty set AND the local value is empty,
        // the MCP save_issue call above omitted dueDate (it rejects null
        // and ignores ""). Clear it via a direct GraphQL mutation, which
        // DOES accept dueDate: null.
        const dueDateCleared = dirtyFields.includes("due_date") && !issue.due_date
        if (dueDateCleared) {
          const clearResult = yield* clearDueDateViaGraphQL({ linearId }).pipe(
            Effect.catchTag("LinearMcpError", (e) => Effect.succeed({ _error: true, message: e.message })),
          )
          if (typeof clearResult === "object" && clearResult !== null && "_error" in clearResult) {
            const msg = String((clearResult as Record<string, unknown>).message ?? "unknown GraphQL error")
            errors.push({ id: issue.id, message: `dueDate clear failed: ${msg}` })
            return
          }
        }

        // L2→L1 conversion: clear the Linear-side parentId via GraphQL.
        // The save_issue call above cannot clear parentId (its Zod schema
        // declares parentId as a pure string). The GraphQL mutation
        // `issueUpdate(input: { parentId: null })` DOES accept null and
        // removes the parent-child relationship on Linear. Idempotent —
        // if Linear already has no parent, the mutation succeeds as a
        // no-op.
        if (parentCleared) {
          const clearResult = yield* clearParentIdViaGraphQL({ linearId }).pipe(
            Effect.catchTag("LinearMcpError", (e) => Effect.succeed({ _error: true, message: e.message })),
          )
          if (typeof clearResult === "object" && clearResult !== null && "_error" in clearResult) {
            const msg = String((clearResult as Record<string, unknown>).message ?? "unknown GraphQL error")
            errors.push({ id: issue.id, message: `parentId clear failed: ${msg}` })
            return
          }
        }

        // `time_updated` is intentionally NOT bumped here — it tracks local
        // edits only (ADR-0002 §D5/D8). Bumping it on push would mask
        // subsequent local dirty checks. `last_pushed_at` is advanced to
        // mark the row as pushed; `last_pulled_at` is seeded so the first
        // pull after push doesn't immediately re-reconcile.
        const stamp = Date.now()
        yield* db
          .update(IssueTable)
          .set({
            last_pushed_at: stamp,
            last_pulled_at: stamp,
            cloud_shadow: JSON.stringify(buildShadowWithParent(issue, all)),
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
  //
  // Sub-issue linking: L1 issues (level 0, no parent) are pushed first.
  // After they're created, their `linear_issue_id` responses are used to
  // resolve `parentId` for L2 issues (level 1, has parent). Linear MCP
  // save_issue accepts `parentId` as the parent's ID or identifier (e.g.,
  // "BOR-15"). Without this two-phase push, all issues would appear as
  // flat top-level issues in Linear (ADR-0001 D3 — reparent implemented).
  const localL1 = localOnly.filter((i) => i.level === 0 || i.parent_id === null)
  const localL2 = localOnly.filter((i) => i.level === 1 && i.parent_id !== null)

  // Map local issue id → linear_issue_id. Seeded with already-linked issues
  // (an L2's parent may have been linked in a prior push). Extended with
  // freshly-created L1 IDs after Cohort 2a completes. JavaScript Maps are
  // safe for concurrent access here because Effect.all with `concurrency`
  // uses cooperative scheduling — `.set()` runs atomically between yields.
  //
  // COOPERATIVE-SCHEDULER ASSUMPTION (ADR-0006 G5):
  // Effect's `Effect.all` with a numeric `concurrency` option uses
  // cooperative scheduling — fibers take turns executing at yield points,
  // and JavaScript's single-threaded event loop guarantees that `.set()`
  // on a Map runs atomically (no other fiber can observe a half-written
  // Map entry). If Effect were to switch to truly parallel fibers (e.g.,
  // worker threads), this assumption would break and `.set()` would need
  // to be replaced with `Effect.Ref<Map>` + `Effect.update` for atomic
  // read-modify-write. A guard test (`sync-push` Phase 2a ordering) is
  // in `test/issue/sync-push-cooperative.test.ts` — it fails if the
  // runtime stops being cooperative.
  const localIdToLinearId = new Map<string, string>(
    all
      .filter((i) => i.linear_issue_id)
      .map((i) => [i.id, i.linear_issue_id!] as const),
  )

  // Shared CREATE logic for both L1 and L2. The optional `parentId`
  // parameter is passed only for L2 issues (resolved from the parent's
  // linear_issue_id via `localIdToLinearId`). Returns the new
  // linear_issue_id on success, or undefined on failure (error already
  // recorded in `errors`).
  const runCreate = (issue: Issue.Info, parentId?: string) =>
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
        // labels/assignee accept null/[] in the MCP schema (anyOf).
        labels: issue.labels ?? [],
        assignee: issue.assignee_id ?? null,
        // parentId: only set for L2 issues (parentId parameter is the
        // parent's linear_issue_id, resolved by the caller). Omitted for
        // L1 issues — they are top-level by definition.
        ...(parentId ? { parentId } : {}),
        // dueDate: only send when non-empty. The MCP schema declares it
        // as a pure string (no null), so null is rejected and "" is
        // ignored. A new issue without a dueDate is the default state
        // on Linear, so omitting it on CREATE is correct.
        ...(issue.due_date ? { dueDate: issue.due_date } : {}),
      }

      const raw = yield* client.callTool(ISSUE.SAVE, saveArgs).pipe(
        // Catch only LinearMcpError; defects propagate (AGENTS.md).
        Effect.catchTag("LinearMcpError", (e) => Effect.succeed({ _error: true, message: e.message })),
      )

      if (typeof raw === "object" && raw !== null && "_error" in raw) {
        const msg = String((raw as Record<string, unknown>).message ?? "unknown MCP error")
        errors.push({ id: issue.id, message: msg })
        return undefined
      }

      // Detect MCP-level validation errors (isError: true).
      const mcpErr = mcpErrorMessage(raw)
      if (mcpErr) {
        errors.push({ id: issue.id, message: `MCP: ${mcpErr}` })
        return undefined
      }

      const parsed = parseSaveIssueResponse(raw)
      if (!parsed) {
        errors.push({
          id: issue.id,
          message: "create_failed: save_issue did not return an id for the new issue",
        })
        return undefined
      }

      // Patch the local row with the new linear_issue_id and advance
      // last_pushed_at so future pushes treat it as up-to-date. Uses a
      // raw DB write (matching the UPDATE path above) instead of
      // `issueSvc.update` to avoid publishing `issue.updated` events
      // during a batch push (the desktop UI refreshes via
      // `serverSync().todo.refresh(directory)` after the push completes
      // in sidebar-linear.tsx handleSync). Historically this also
      // bypassed the now-removed `IssueArchivedError` guard; the guard
      // is gone (ADR-0001 Amendment 2026-07-19 §D17), but the raw-write
      // pattern is retained because push is a batch operation that
      // should not fan out N bus events.
      //
      // Store the projectId/teamId UUIDs from the Linear response — NOT
      // the config values, which may be slugs (e.g.
      // "graduationdesign-69b3bec34c5f") extracted from the project URL.
      // The UUIDs are needed for verifyLinearIssue to correctly compare
      // against get_issue's projectId/teamId on subsequent pushes.
      // `time_updated` is intentionally NOT bumped — it tracks local
      // edits only (ADR-0002 §D5/D8). Bumping it on push would mask
      // subsequent local dirty checks.
      const stamp = Date.now()
      yield* db
        .update(IssueTable)
        .set({
          linear_issue_id: parsed.id,
          linear_team_id: parsed.teamId ?? cfg.teamId!,
          linear_project_id: parsed.projectId ?? null,
          last_pushed_at: stamp,
          // Seed the pull watermark so the first pull after CREATE
          // doesn't immediately re-reconcile (Linear bumped updatedAt
          // when it created the issue).
          last_pulled_at: stamp,
          // Include `linear_parent_id` in the seed shadow so the next
          // push doesn't re-send parentId for L2 issues that were just
          // created with a parent. For L1 issues, linear_parent_id is
          // null (no parent).
          cloud_shadow: JSON.stringify(buildShadowWithParent(issue, all)),
        })
        .where(and(eq(IssueTable.directory, input.directory), eq(IssueTable.id, issue.id)))
        .run()
        .pipe(Effect.orDie)

      return parsed.id
    })

  // Cohort 2a: push L1 issues (no parent). Results extend the
  // localIdToLinearId map so Cohort 2b can resolve parent links for L2.
  // Track which L1 issues failed to create — Cohort 2b uses this to give
  // an actionable error message when an L2's parent failed in 2a (vs.
  // the parent simply not being linked yet).
  const failedL1Ids = new Set<string>()
  yield* Effect.all(
    localL1.map((issue) =>
      Effect.gen(function* () {
        const newLinearId = yield* runCreate(issue)
        if (newLinearId) {
          localIdToLinearId.set(issue.id, newLinearId)
          ids.push(newLinearId)
          return
        }
        // runCreate already recorded the failure in `errors`; track the
        // local id so Cohort 2b can distinguish "parent failed in 2a"
        // from "parent never linked".
        failedL1Ids.add(issue.id)
      }),
    ),
    { concurrency: DEFAULT_BATCH, discard: true },
  )

  // Cohort 2b: push L2 issues (with parent). `parentId` is resolved from
  // the parent's linear_issue_id via `localIdToLinearId`. If the parent
  // is not linked (and wasn't just created in Cohort 2a), the L2 is
  // skipped with an error — the parent must be pushed first so Linear can
  // establish the parent-child link.
  //
  // Error message distinguishes two cases:
  //   - parent_failed: parent was in Cohort 2a but its CREATE failed.
  //     Actionable: fix the parent's error (see prior `errors` entry),
  //     then push again. The L2 cannot be created until the parent exists.
  //   - parent_not_linked: parent was NOT in Cohort 2a (already linked
  //     from a prior push) but its linear_issue_id is missing. This
  //     indicates a data-integrity issue — the parent row should have
  //     been linked. Actionable: investigate the parent's
  //     linear_issue_id column.
  yield* Effect.all(
    localL2.map((issue) =>
      Effect.gen(function* () {
        const parentId = issue.parent_id ? localIdToLinearId.get(issue.parent_id) : undefined
        if (!parentId) {
          if (issue.parent_id && failedL1Ids.has(issue.parent_id)) {
            errors.push({
              id: issue.id,
              message: `parent_failed: parent issue ${issue.parent_id} failed to create in Phase 2a (see prior errors); L2 skipped until parent is fixed`,
            })
            return
          }
          errors.push({
            id: issue.id,
            message: `parent_not_linked: parent issue ${issue.parent_id} has no linear_issue_id; cannot set parentId`,
          })
          return
        }
        const newLinearId = yield* runCreate(issue, parentId)
        if (newLinearId) {
          ids.push(newLinearId)
        }
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

export * as SyncPush from "./sync-push"
