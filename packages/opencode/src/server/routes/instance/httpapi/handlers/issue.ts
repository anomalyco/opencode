import { InstanceState } from "@/effect/instance-state"
import { Issue } from "@/issue/issue"
import { LinearBinding } from "@/issue/linear-binding"
import { SyncPull } from "@/issue/sync-pull"
import { SyncPush } from "@/issue/sync-push"
import { LinearMcpClient } from "@/issue/mcp-client"
import { USER, TEAM, PROJECT, ISSUE } from "@/issue/tool-names"
import { MCP } from "@/mcp"
import { Effect, Exit, Schema, Option } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { LinearBindingSetPayload, IssueCreatePayload, IssueUpdatePayload } from "../groups/issue"

type LinearUserRaw = { id: string; name: string; email?: string; avatarUrl?: string }
type LinearStatusRaw = { id: string; name: string; color?: string }
type LinearTeamRaw = { id: string; name: string; key?: string }
type LinearProjectRaw = { id: string; name: string; state?: string }

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

const parseContent = (raw: unknown): unknown => {
  if (!raw || typeof raw !== "object") return raw
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.content)) return raw
  for (const item of r.content) {
    if (typeof item !== "object" || !item) continue
    const c = item as Record<string, unknown>
    if (c.type === "text" && typeof c.text === "string") {
      const parsed = Option.getOrUndefined(decodeJson(c.text))
      if (parsed !== undefined) return parsed
    }
  }
  return raw
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
    const mcp = yield* MCP.Service

    // Cached fallback client created from LINEAR_API_KEY env var. Lives in
    // the layer closure so it's reused across requests. Wrapped in a single
    // mutable ref object so the outer scope only needs one `const` binding
    // (per AGENTS.md "avoid `let` where `const` suffices"). The ref is
    // mutated in place; cleared only by process restart.
    const envClientRef: { client: LinearMcpClient | null; failed: boolean } = {
      client: null,
      failed: false,
    }

    const getLinearClient = Effect.fn("IssueHttpApi.getLinearClient")(function* () {
      // Path A: Linear MCP registered in opencode.jsonc → use the project's
      // already-connected MCP client.
      const clients = yield* mcp.clients()
      const raw = clients["linear"]
      if (raw) return LinearMcpClient.wrap(raw)
      // Path B: no MCP registration; fall back to a direct connection
      // using LINEAR_API_KEY. After one failure (missing env var or
      // connection error) we stop retrying — the user must fix env/config
      // and restart the server.
      if (envClientRef.client) return envClientRef.client
      if (envClientRef.failed) return undefined
      const exit = yield* LinearMcpClient.create().pipe(Effect.exit)
      if (Exit.isFailure(exit)) {
        envClientRef.failed = true
        yield* Effect.logWarning(`[IssueHttpApi.getLinearClient] LinearMcpClient.create failed: ${String(exit)}`)
        return undefined
      }
      envClientRef.client = exit.value
      return envClientRef.client
    })

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
      if (!found) return yield* Effect.fail(new HttpApiError.NotFound({}))
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
      yield* issue
        .delete({ directory, id: ctx.params.id })
        .pipe(
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
      const hasAny = body.teamId || body.projectId || body.teamName || body.projectName || body.projectUrl
      const binding = hasAny
        ? {
            teamId: body.teamId ?? "",
            teamName: body.teamName ?? "",
            projectId: body.projectId ?? "",
            ...(body.projectName ? { projectName: body.projectName } : {}),
            ...(body.projectUrl ? { projectUrl: body.projectUrl } : {}),
          }
        : null
      return yield* linearBinding.set(binding as LinearBinding.Binding | null)
    })

    const linearTeams = Effect.fn("IssueHttpApi.linearTeams")(function* () {
      const client = yield* getLinearClient()
      if (!client) return []
      const exit = yield* client.callTool(TEAM.LIST, { limit: 100 }).pipe(Effect.exit)
      if (Exit.isFailure(exit)) return []
      return parseTeams(exit.value)
    })

    const linearProjects = Effect.fn("IssueHttpApi.linearProjects")(function* (ctx: { query?: { team?: string } }) {
      const client = yield* getLinearClient()
      if (!client) return []
      const args: Record<string, unknown> = { limit: 50 }
      const teamFilter = ctx.query?.team
      if (teamFilter) args.team = teamFilter
      const exit = yield* client.callTool(PROJECT.LIST, args).pipe(Effect.exit)
      if (Exit.isFailure(exit)) return []
      return parseProjects(exit.value)
    })

    const linearUsers = Effect.fn("IssueHttpApi.linearUsers")(function* () {
      const client = yield* getLinearClient()
      if (!client) return []
      const exit = yield* client.callTool(USER.LIST, { limit: 100 }).pipe(Effect.exit)
      if (Exit.isFailure(exit)) return []
      return parseUsers(exit.value)
    })

    const linearStatuses = Effect.fn("IssueHttpApi.linearStatuses")(function* () {
      const binding = yield* linearBinding.get()
      if (!binding?.teamId) return []
      const client = yield* getLinearClient()
      if (!client) return []
      const exit = yield* client.callTool(ISSUE.LIST_STATUSES, { team: binding.teamId }).pipe(Effect.exit)
      if (Exit.isFailure(exit)) return []
      return parseStatuses(exit.value)
    })

    const syncPull = Effect.fn("IssueHttpApi.syncPull")(function* () {
      const directory = yield* InstanceState.directory
      const client = yield* getLinearClient()
      if (!client) return yield* Effect.fail(new HttpApiError.BadRequest({}))
      // The Linear MCP client is resolved per-request via `getLinearClient()`
      // (Path A: shared project MCP client; Path B: env-var fallback). Because
      // the client identity depends on per-request resolution (which may even
      // return undefined, in which case we bail above), it cannot be supplied
      // by a layer-level middleware. A middleware would have to either run
      // `getLinearClient()` itself (re-implementing the per-request branching
      // and the missing-client short-circuit) or always provide *some* client,
      // which would force every Issue route to pay the Linear connection cost
      // even when the route does not talk to Linear. `Effect.provideService`
      // here keeps the Linear dependency scoped to exactly the two routes
      // (`syncPull`, `syncPush`) that need it, with no impact on the other
      // Issue routes in this same handler module.
      return yield* SyncPull.pull({ directory }).pipe(
        Effect.provideService(SyncPull.Client, client),
        Effect.catchDefect((defect: unknown) =>
          Effect.gen(function* () {
            yield* Effect.logError(`[IssueHttpApi.syncPull] defect: ${String(defect)}`)
            return yield* Effect.fail(new SyncPull.SyncPullError({ message: String(defect) }))
          }),
        ),
        Effect.tapError((error) => Effect.logError(`[IssueHttpApi.syncPull] error: ${String(error)}`)),
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
    })

    const syncPush = Effect.fn("IssueHttpApi.syncPush")(function* () {
      const directory = yield* InstanceState.directory
      const client = yield* getLinearClient()
      if (!client) return yield* Effect.fail(new HttpApiError.BadRequest({}))
      // See `syncPull` above for the rationale on per-request
      // `Effect.provideService` vs. layer-level middleware. The Linear client
      // is request-scoped, may be undefined (handled by the early return
      // above), and must not be forced on routes that do not call Linear.
      return yield* SyncPush.push({ directory, issueIds: "all" }).pipe(
        Effect.provideService(SyncPush.Client, client),
        Effect.catchDefect((defect: unknown) =>
          Effect.gen(function* () {
            yield* Effect.logError(`[IssueHttpApi.syncPush] defect: ${String(defect)}`)
            return yield* Effect.fail(new SyncPush.SyncPushError({ message: String(defect) }))
          }),
        ),
        Effect.tapError((error) => Effect.logError(`[IssueHttpApi.syncPush] error: ${String(error)}`)),
        Effect.mapError(() => new HttpApiError.BadRequest({})),
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
