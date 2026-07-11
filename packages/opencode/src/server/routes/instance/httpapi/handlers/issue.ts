import * as InstanceState from "@/effect/instance-state"
import { Issue } from "@/issue/issue"
import { AutoProgress } from "@/issue/auto-progress"
import { LinearBinding } from "@/issue/linear-binding"
import { SyncPull } from "@/issue/sync-pull"
import { SyncPush } from "@/issue/sync-push"
import { LinearMcpClient, LinearMcpError } from "@/issue/mcp-client"
import { USER, TEAM, PROJECT, ISSUE } from "@/issue/tool-names"
import { MCP } from "@/mcp"
import { Effect, Exit } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { LinearBindingSetPayload, IssueCreatePayload, IssueUpdatePayload } from "../groups/issue"

type LinearUserRaw = { id: string; name: string; email?: string; avatarUrl?: string }
type LinearStatusRaw = { id: string; name: string; color?: string }
type LinearTeamRaw = { id: string; name: string; key?: string }
type LinearProjectRaw = { id: string; name: string; state?: string }

const parseContent = (raw: unknown): unknown => {
  if (!raw || typeof raw !== "object") return raw
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.content)) return raw
  for (const item of r.content) {
    if (typeof item !== "object" || !item) continue
    const c = item as Record<string, unknown>
    if (c.type === "text" && typeof c.text === "string") {
      return JSON.parse(c.text)
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
    const autoProgress = yield* AutoProgress.Service
    const linearBinding = yield* LinearBinding.Service
    const mcp = yield* MCP.Service

    const getLinearClient = Effect.fn("IssueHttpApi.getLinearClient")(function* () {
      const clients = yield* mcp.clients()
      const raw = clients["linear"]
      if (!raw) return undefined
      return LinearMcpClient.wrap(raw)
    })

    const list = Effect.fn("IssueHttpApi.list")(function* () {
      const directory = yield* InstanceState.directory
      return yield* issue.get({ directory })
    })

    const get = Effect.fn("IssueHttpApi.get")(function* (ctx: { params: { id: string } }) {
      const directory = yield* InstanceState.directory
      const issues = yield* issue.get({ directory })
      const found = issues.find((i) => i.id === ctx.params.id)
      if (!found) return yield* Effect.fail(new HttpApiError.NotFound({}))
      return found
    })

    const create = Effect.fn("IssueHttpApi.create")(function* (ctx: { payload: typeof IssueCreatePayload.Type }) {
      const directory = yield* InstanceState.directory
      const issueData = { ...ctx.payload.issue }
      if (issueData.labels) issueData.labels = [...issueData.labels]
      return yield* issue.create({ directory, issue: issueData as Partial<Issue.Info> })
    })

    const update = Effect.fn("IssueHttpApi.update")(function* (ctx: {
      params: { id: string }
      payload: typeof IssueUpdatePayload.Type
    }) {
      const directory = yield* InstanceState.directory
      const patch = { ...ctx.payload.patch }
      if (patch.labels) patch.labels = [...patch.labels]
      return yield* issue.update({ directory, id: ctx.params.id, patch: patch as Partial<Issue.Info> })
    })

    const remove = Effect.fn("IssueHttpApi.delete")(function* (ctx: { params: { id: string } }) {
      const directory = yield* InstanceState.directory
      yield* issue.delete({ directory, id: ctx.params.id })
      return true
    })

    const reorder = Effect.fn("IssueHttpApi.reorder")(function* (ctx: { payload: { ids: readonly string[] } }) {
      const directory = yield* InstanceState.directory
      yield* issue.reorder({ directory, ids: [...ctx.payload.ids] })
      return true
    })

    const autoProgressStart = Effect.fn("IssueHttpApi.autoProgressStart")(function* () {
      const directory = yield* InstanceState.directory
      yield* autoProgress.start(directory)
      return true
    })

    const autoProgressStop = Effect.fn("IssueHttpApi.autoProgressStop")(function* () {
      const directory = yield* InstanceState.directory
      yield* autoProgress.stop(directory)
      return true
    })

    const autoProgressStatus = Effect.fn("IssueHttpApi.autoProgressStatus")(function* () {
      const directory = yield* InstanceState.directory
      const status = yield* autoProgress.status(directory)
      return { status }
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
      return yield* SyncPull.pull({ directory }).pipe(
        Effect.provideService(SyncPull.Client, client),
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
    })

    const syncPush = Effect.fn("IssueHttpApi.syncPush")(function* () {
      const directory = yield* InstanceState.directory
      const client = yield* getLinearClient()
      if (!client) return yield* Effect.fail(new HttpApiError.BadRequest({}))
      return yield* SyncPush.push({ directory, issueIds: "all" }).pipe(
        Effect.provideService(SyncPush.Client, client),
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
    })

    return handlers
      .handle("list", list)
      .handle("get", get)
      .handle("create", create)
      .handle("update", update)
      .handle("delete", remove)
      .handle("reorder", reorder)
      .handle("autoProgressStart", autoProgressStart)
      .handle("autoProgressStop", autoProgressStop)
      .handle("autoProgressStatus", autoProgressStatus)
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
