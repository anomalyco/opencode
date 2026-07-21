// Linear client injection is handled by `LinearClientMiddleware` (see
// `middleware/linear-client.ts`), which provides `LinearClientRef` per
// request. Handlers yield `LinearClientRef` to get the resolved
// `LinearMcpClient | null`; they do NOT call `Effect.provideService` to
// inject it (per `httpapi/AGENTS.md` line 35: "Use
// `Effect.provideService(...)` in middleware only for request-derived
// context").

import { InstanceState } from "@/effect/instance-state"
import { Issue } from "@/issue/issue"
import { LinearBinding } from "@/issue/linear-binding"
import { SyncPull } from "@/issue/sync-pull"
import { SyncPush } from "@/issue/sync-push"
import { LinearClientRef } from "@/issue/mcp-client"
import { USER, TEAM, PROJECT, ISSUE } from "@/issue/tool-names"
import { Effect, Exit, Option, Schema } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { LinearBindingSetPayload, IssueCreatePayload, IssueUpdatePayload } from "../groups/issue"

type LinearUserRaw = { id: string; name: string; email?: string; avatarUrl?: string }
type LinearStatusRaw = { id: string; name: string; color?: string }
type LinearTeamRaw = { id: string; name: string; key?: string }
type LinearProjectRaw = { id: string; name: string; state?: string }

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

// MCP tool results are untyped at the TS boundary: `Client.callTool` returns
// `unknown` (the MCP SDK types the wire shape as `CallToolResult` but our
// wrapper unwraps it to `unknown`). The Linear MCP server wraps its GraphQL
// response data inside `{ content: [{ type: "text", text: "<json>" }] }`.
// The `as Record<string, unknown>` casts below are the unavoidable price of
// bridging an untyped protocol to typed code — Schema validation happens at
// the inner `decodeJson` call, the outer shape is structurally asserted.
const parseContent = (raw: unknown): unknown => {
  if (!raw || typeof raw !== "object") return raw
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.content)) return raw
  const parsed = r.content
    .map((item): unknown => {
      if (typeof item !== "object" || !item) return undefined
      const c = item as Record<string, unknown>
      if (c.type !== "text" || typeof c.text !== "string") return undefined
      return Option.getOrUndefined(decodeJson(c.text))
    })
    .find((x): x is NonNullable<typeof x> => x !== undefined)
  return parsed ?? raw
}

const parseUsers = (raw: unknown): LinearUserRaw[] => {
  const parsed = parseContent(raw)
  if (!parsed || typeof parsed !== "object") return []
  const p = parsed as Record<string, unknown>
  const list = Array.isArray(p.users)
    ? p.users
    : p.data && typeof p.data === "object"
      ? Array.isArray((p.data as Record<string, unknown>).users)
        ? (p.data as Record<string, unknown>).users
        : undefined
      : undefined
  if (!Array.isArray(list)) return []
  return list
    .filter((n): n is Record<string, unknown> => typeof n === "object" && n !== null)
    .filter((u) => typeof u.id === "string" && typeof u.name === "string" && u.name !== "Linear")
    .map((u) => ({
      id: u.id as string,
      name: u.name as string,
      ...(typeof u.email === "string" ? { email: u.email } : {}),
      ...(typeof u.avatarUrl === "string" ? { avatarUrl: u.avatarUrl } : {}),
    }))
}

const parseStatuses = (raw: unknown): LinearStatusRaw[] => {
  const parsed = parseContent(raw)
  if (Array.isArray(parsed)) {
    return parsed
      .filter((n): n is Record<string, unknown> => typeof n === "object" && n !== null)
      .map((n) => ({
        id: typeof n.id === "string" ? n.id : "",
        name: typeof n.name === "string" ? n.name : "",
        ...(typeof n.color === "string" ? { color: n.color } : {}),
      }))
      .filter((s) => s.name.length > 0)
  }
  if (!parsed || typeof parsed !== "object") return []
  const p = parsed as Record<string, unknown>
  const list = Array.isArray(p.statuses)
    ? p.statuses
    : p.data && typeof p.data === "object"
      ? Array.isArray((p.data as Record<string, unknown>).issueStatuses)
        ? (p.data as Record<string, unknown>).issueStatuses
        : undefined
      : undefined
  if (!Array.isArray(list)) return []
  return list
    .filter((n): n is Record<string, unknown> => typeof n === "object" && n !== null)
    .filter((s) => typeof s.name === "string" && (s.name as string).length > 0)
    .map((s) => ({
      id: typeof s.id === "string" ? s.id : "",
      name: s.name as string,
      ...(typeof s.color === "string" ? { color: s.color } : {}),
    }))
}

const parseTeams = (raw: unknown): LinearTeamRaw[] => {
  const parsed = parseContent(raw)
  if (!parsed || typeof parsed !== "object") return []
  const p = parsed as Record<string, unknown>
  const list = Array.isArray(p.teams)
    ? p.teams
    : p.data && typeof p.data === "object"
      ? Array.isArray((p.data as Record<string, unknown>).teams)
        ? (p.data as Record<string, unknown>).teams
        : undefined
      : undefined
  if (!Array.isArray(list)) return []
  return list
    .filter((n): n is Record<string, unknown> => typeof n === "object" && n !== null)
    .filter((t) => typeof t.id === "string" && typeof t.name === "string")
    .map((t) => ({
      id: t.id as string,
      name: t.name as string,
      ...(typeof t.key === "string" ? { key: t.key } : {}),
    }))
}

const parseProjects = (raw: unknown): LinearProjectRaw[] => {
  const parsed = parseContent(raw)
  if (!parsed || typeof parsed !== "object") return []
  const p = parsed as Record<string, unknown>
  const list = Array.isArray(p.projects)
    ? p.projects
    : p.data && typeof p.data === "object"
      ? Array.isArray((p.data as Record<string, unknown>).projects)
        ? (p.data as Record<string, unknown>).projects
        : undefined
      : undefined
  if (!Array.isArray(list)) return []
  return list
    .filter((n): n is Record<string, unknown> => typeof n === "object" && n !== null)
    .filter((pr) => typeof pr.id === "string" && typeof pr.name === "string")
    .map((pr) => ({
      id: pr.id as string,
      name: pr.name as string,
      ...(typeof pr.state === "string" ? { state: pr.state } : {}),
    }))
}

export const issueHandlers = HttpApiBuilder.group(InstanceHttpApi, "issue", (handlers) =>
  Effect.gen(function* () {
    const issue = yield* Issue.Service
    const linearBinding = yield* LinearBinding.Service

    const list = Effect.fn("IssueHttpApi.list")(function* (ctx: { query?: { include_archived?: boolean } }) {
      const directory = yield* InstanceState.directory
      return yield* issue.get({ directory, include_archived: ctx.query?.include_archived ?? false })
    })

    const get = Effect.fn("IssueHttpApi.get")(function* (ctx: {
      params: { id: string }
      query?: { include_archived?: boolean }
    }) {
      const directory = yield* InstanceState.directory
      const issues = yield* issue.get({ directory, include_archived: ctx.query?.include_archived ?? false })
      const found = issues.find((i) => i.id === ctx.params.id)
      if (!found) return yield* new HttpApiError.NotFound({})
      return found
    })

    const create = Effect.fn("IssueHttpApi.create")(function* (ctx: { payload: typeof IssueCreatePayload.Type }) {
      const directory = yield* InstanceState.directory
      const issueData = { ...ctx.payload.issue }
      if (issueData.labels) issueData.labels = [...issueData.labels]
      return yield* issue.create({ directory, issue: issueData as Partial<Issue.Info> }).pipe(
        Effect.catchTag("Issue.HierarchyError", () => Effect.fail(new HttpApiError.BadRequest({}))),
        // NotFoundError here means the just-inserted row was not visible
        // to `publish()` (race or DB consistency issue). Surface as 500
        // semantically, but the API group only allows BadRequest, so
        // BadRequest is the closest fit (indicates a request-time anomaly).
        Effect.catchTag("Issue.NotFoundError", () => Effect.fail(new HttpApiError.BadRequest({}))),
      )
    })

    const update = Effect.fn("IssueHttpApi.update")(function* (ctx: {
      params: { id: string }
      payload: typeof IssueUpdatePayload.Type
    }) {
      const directory = yield* InstanceState.directory
      const patch = { ...ctx.payload.patch }
      if (patch.labels) patch.labels = [...patch.labels]
      return yield* issue.update({ directory, id: ctx.params.id, patch: patch as Partial<Issue.Info> }).pipe(
        Effect.catchTag("Issue.NotFoundError", () => Effect.fail(new HttpApiError.NotFound({}))),
        Effect.catchTag("Issue.HierarchyError", () => Effect.fail(new HttpApiError.BadRequest({}))),
      )
    })

    const remove = Effect.fn("IssueHttpApi.remove")(function* (ctx: { params: { id: string } }) {
      const directory = yield* InstanceState.directory
      yield* issue.delete({ directory, id: ctx.params.id }).pipe(
        Effect.catchTag("Issue.NotArchivedError", () => Effect.fail(new HttpApiError.BadRequest({}))),
        Effect.catchTag("Issue.NotFoundError", () => Effect.fail(new HttpApiError.NotFound({}))),
      )
      return true
    })

    const reorder = Effect.fn("IssueHttpApi.reorder")(function* (ctx: { payload: { ids: readonly string[] } }) {
      const directory = yield* InstanceState.directory
      yield* issue.reorder({ directory, ids: [...ctx.payload.ids] })
      return true
    })

    const archive = Effect.fn("IssueHttpApi.archive")(function* (ctx: {
      params: { id: string }
      payload: { outcome: "done" | "canceled" | "duplicate" }
    }) {
      const directory = yield* InstanceState.directory
      return yield* issue.archive({ directory, id: ctx.params.id, outcome: ctx.payload.outcome }).pipe(
        Effect.catchTag("Issue.NotFoundError", () => Effect.fail(new HttpApiError.NotFound({}))),
      )
    })

    const linearBindingGet = Effect.fn("IssueHttpApi.linearBindingGet")(function* () {
      return yield* linearBinding.get()
    })

    const linearBindingSet = Effect.fn("IssueHttpApi.linearBindingSet")(function* (ctx: {
      payload: typeof LinearBindingSetPayload.Type
    }) {
      const body = ctx.payload
      // ADR-0004 D3: the payload fields are all optional, but `set()` writes
      // a full `Binding | null`. Treat the payload as a partial update and
      // merge with the existing binding so `PUT { teamId: "x" }` does NOT
      // clobber a previously-stored `projectId`. Sending all fields empty
      // (or sending `{}`) clears the binding entirely (writes null).
      const hasAny = body.teamId || body.projectId || body.teamName || body.projectName || body.projectUrl
      if (!hasAny) return yield* linearBinding.set(null)
      const existing = yield* linearBinding.get()
      const merged: LinearBinding.Binding = {
        teamId: body.teamId ?? existing?.teamId ?? "",
        teamName: body.teamName ?? existing?.teamName ?? "",
        projectId: body.projectId ?? existing?.projectId ?? "",
        ...(body.projectName !== undefined
          ? { projectName: body.projectName }
          : existing?.projectName !== undefined
            ? { projectName: existing.projectName }
            : {}),
        ...(body.projectUrl !== undefined
          ? { projectUrl: body.projectUrl }
          : existing?.projectUrl !== undefined
            ? { projectUrl: existing.projectUrl }
            : {}),
      }
      return yield* linearBinding.set(merged)
    })

    const linearTeams = Effect.fn("IssueHttpApi.linearTeams")(function* () {
      const client = yield* LinearClientRef
      if (!client) return []
      const exit = yield* client.callTool(TEAM.LIST, { limit: 100 }).pipe(Effect.exit)
      if (Exit.isFailure(exit)) return []
      return parseTeams(exit.value)
    })

    const linearProjects = Effect.fn("IssueHttpApi.linearProjects")(function* (ctx: { query?: { team?: string } }) {
      const client = yield* LinearClientRef
      if (!client) return []
      const args: Record<string, unknown> = { limit: 50 }
      const teamFilter = ctx.query?.team
      if (teamFilter) args.team = teamFilter
      const exit = yield* client.callTool(PROJECT.LIST, args).pipe(Effect.exit)
      if (Exit.isFailure(exit)) return []
      return parseProjects(exit.value)
    })

    const linearUsers = Effect.fn("IssueHttpApi.linearUsers")(function* () {
      const client = yield* LinearClientRef
      if (!client) return []
      const exit = yield* client.callTool(USER.LIST, { limit: 100 }).pipe(Effect.exit)
      if (Exit.isFailure(exit)) return []
      return parseUsers(exit.value)
    })

    const linearStatuses = Effect.fn("IssueHttpApi.linearStatuses")(function* () {
      const binding = yield* linearBinding.get()
      if (!binding?.teamId) return []
      const client = yield* LinearClientRef
      if (!client) return []
      const exit = yield* client.callTool(ISSUE.LIST_STATUSES, { team: binding.teamId }).pipe(Effect.exit)
      if (Exit.isFailure(exit)) return []
      return parseStatuses(exit.value)
    })

    const syncPull = Effect.fn("IssueHttpApi.syncPull")(function* () {
      const directory = yield* InstanceState.directory
      const client = yield* LinearClientRef
      if (!client) return yield* new HttpApiError.BadRequest({})
      // `LinearClientRef` is provided per-request by `LinearClientMiddleware`
      // (see top-of-file comment). `SyncPull.pull` consumes the same tag, so
      // the handler's null-check above is the only Linear-client gating.
      return yield* SyncPull.pull({ directory }).pipe(
        // Precise error mapping per AGENTS.md errors.md "Do not map every
        // domain error into one universal HTTP error class". Sync is a
        // server-side operation: every non-defect failure (SyncPullError,
        // LinearMcpError, unexpected throws from the MCP SDK / Drizzle)
        // indicates a server-side problem, not a client input problem.
        //   - `SyncPullError` (tagged) → 500 InternalServerError — fatal
        //     sync precondition failure (missing Linear binding, MCP
        //     transport failure). Not a client input problem.
        //   - `LinearMcpError` (tagged) → 500 InternalServerError — Linear
        //     API/MCP transport failure. Server-side.
        //   - Other non-defect failures → 500 InternalServerError (defensive
        //     default; sync is server-side, so 500 is the correct shape).
        // Defects (Interrupt/Die) propagate naturally — NOT caught, so
        // unexpected bugs surface in logs rather than being masked as 400.
        Effect.tapError((error) => Effect.logError(`[IssueHttpApi.syncPull] error: ${String(error)}`)),
        Effect.catchTag("SyncPullError", () => new HttpApiError.InternalServerError({})),
        Effect.mapError(() => new HttpApiError.InternalServerError({})),
      )
    })

    const syncPush = Effect.fn("IssueHttpApi.syncPush")(function* () {
      const directory = yield* InstanceState.directory
      const client = yield* LinearClientRef
      if (!client) return yield* new HttpApiError.BadRequest({})
      // See `syncPull` above for the LinearClientRef / middleware rationale.
      // `issueIds: []` per ADR-0005 D3 — empty filter means "push all
      // dirty issues" (bulk sync), not "push zero issues".
      return yield* SyncPush.push({ directory, issueIds: [] }).pipe(
        // See `syncPull` above for the precise error mapping rationale.
        // Sync is server-side, so all non-defect failures map to 500.
        Effect.tapError((error) => Effect.logError(`[IssueHttpApi.syncPush] error: ${String(error)}`)),
        Effect.catchTag("SyncPushError", () => new HttpApiError.InternalServerError({})),
        Effect.mapError(() => new HttpApiError.InternalServerError({})),
      )
    })

    return handlers
      .handle("list", list)
      .handle("get", get)
      .handle("create", create)
      .handle("update", update)
      .handle("remove", remove)
      .handle("reorder", reorder)
      .handle("archive", archive)
      .handle("linearBindingGet", linearBindingGet)
      .handle("linearBindingSet", linearBindingSet)
      .handle("linearTeams", linearTeams)
      .handle("linearProjects", linearProjects)
      .handle("linearUsers", linearUsers)
      .handle("linearStatuses", linearStatuses)
      .handle("syncPull", syncPull)
      .handle("syncPush", syncPush)
  }),
)
