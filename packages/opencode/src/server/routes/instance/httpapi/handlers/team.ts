import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Effect } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceState } from "@/effect/instance-state"
import { Permission } from "@/permission"
import { Instance } from "@/project/instance"
import { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { Team, TeamTasks, WRITE_TOOLS } from "@/team"
import { TeamMessaging } from "@/team/messaging"
import { InstanceHttpApi } from "../api"
import {
  TeamApiError,
  TeamApprovePlanPayload,
  TeamCancelPayload,
  TeamDelegatePayload,
  TeamMessagePayload,
  TeamShutdownPayload,
} from "../groups/team"

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

const runLegacyTeam = <A>(operation: () => Promise<A>) =>
  Effect.gen(function* () {
    const instance = yield* InstanceState.context
    return yield* Effect.tryPromise({
      try: () => Instance.provide(instance, operation),
      catch: (error) => new TeamApiError({ message: errorMessage(error) }),
    })
  })

function teamNotFound() {
  return HttpServerResponse.jsonUnsafe({ error: "Team not found" }, { status: 404 })
}

export const teamHandlers = HttpApiBuilder.group(InstanceHttpApi, "team", (handlers) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service

    const list = Effect.fn("TeamHttpApi.list")(function* () {
      return yield* runLegacyTeam(() => Team.list())
    })

    const get = Effect.fn("TeamHttpApi.get")(function* (ctx: { params: { teamName: string } }) {
      const team = yield* runLegacyTeam(() => Team.get(ctx.params.teamName))
      if (!team) return teamNotFound()
      return team
    })

    const tasks = Effect.fn("TeamHttpApi.tasks")(function* (ctx: { params: { teamName: string } }) {
      const team = yield* runLegacyTeam(() => Team.get(ctx.params.teamName))
      if (!team) return []
      return yield* runLegacyTeam(() => TeamTasks.list(ctx.params.teamName))
    })

    const bySession = Effect.fn("TeamHttpApi.bySession")(function* (ctx: { params: { sessionID: SessionID } }) {
      return yield* runLegacyTeam(async () => {
        const match = await Team.findBySession(ctx.params.sessionID)
        if (!match) return null
        return {
          team: match.team,
          tasks: await TeamTasks.list(match.team.name),
          role: match.role,
          ...(match.memberName ? { memberName: match.memberName } : {}),
        }
      })
    })

    const delegate = Effect.fn("TeamHttpApi.delegate")(function* (ctx: {
      params: { teamName: string }
      payload: typeof TeamDelegatePayload.Type
    }) {
      const team = yield* runLegacyTeam(async () => {
        await Team.setDelegate(ctx.params.teamName, ctx.payload.enabled)
        return await Team.get(ctx.params.teamName)
      })
      if (!team) return teamNotFound()

      const leadSessionID = SessionID.make(team.leadSessionID)
      const current = yield* sessions
        .get(leadSessionID)
        .pipe(Effect.mapError(() => new TeamApiError({ message: `Lead session "${team.leadSessionID}" not found` })))
      const existing = current.permission ?? []
      const permission = ctx.payload.enabled
        ? Permission.merge(existing, delegateDenyRules(existing))
        : existing.filter(
            (rule) => !((WRITE_TOOLS as readonly string[]).includes(rule.permission) && rule.action === "deny"),
          )

      yield* sessions.setPermission({ sessionID: leadSessionID, permission })
      return { ok: true, delegate: ctx.payload.enabled }
    })

    const cancel = Effect.fn("TeamHttpApi.cancel")(function* (ctx: {
      params: { teamName: string }
      payload: typeof TeamCancelPayload.Type
    }) {
      const cancelled = yield* runLegacyTeam(async () => {
        if (ctx.payload.member) return (await Team.cancelMember(ctx.params.teamName, ctx.payload.member)) ? 1 : 0
        return await Team.cancelAllMembers(ctx.params.teamName)
      })
      return { ok: true, cancelled }
    })

    const approvePlan = Effect.fn("TeamHttpApi.approvePlan")(function* (ctx: {
      params: { teamName: string }
      payload: typeof TeamApprovePlanPayload.Type
    }) {
      yield* runLegacyTeam(async () => {
        const team = await Team.get(ctx.params.teamName)
        if (!team) throw new Error(`Team "${ctx.params.teamName}" not found`)
        const member = team.members.find((item) => item.name === ctx.payload.member)
        if (!member) throw new Error(`Teammate "${ctx.payload.member}" not found`)
        if (member.planApproval !== "pending" && member.planApproval !== "rejected") {
          throw new Error(
            `Teammate "${ctx.payload.member}" is not awaiting plan approval (current: ${member.planApproval ?? "none"})`,
          )
        }
        await Team.approvePlan({
          teamName: ctx.params.teamName,
          memberName: ctx.payload.member,
          approved: ctx.payload.approved,
          feedback: ctx.payload.feedback,
        })
      })
      return { ok: true, approved: ctx.payload.approved }
    })

    const shutdown = Effect.fn("TeamHttpApi.shutdown")(function* (ctx: {
      params: { teamName: string }
      payload: typeof TeamShutdownPayload.Type
    }) {
      const status = yield* runLegacyTeam(async () => {
        const team = await Team.get(ctx.params.teamName)
        if (!team) throw new Error(`Team "${ctx.params.teamName}" not found`)
        const member = team.members.find((item) => item.name === ctx.payload.member)
        if (!member) throw new Error(`Teammate "${ctx.payload.member}" not found`)
        if (member.status === "shutdown") return "shutdown" as const

        await Team.transitionMemberStatus(ctx.params.teamName, ctx.payload.member, "shutdown_requested")
        const sent = await TeamMessaging.send({
          teamName: ctx.params.teamName,
          from: "lead",
          to: ctx.payload.member,
          text: [
            `SHUTDOWN REQUEST: ${ctx.payload.reason ?? "The lead has requested you shut down."}`,
            "",
            "Please wrap up your current work:",
            "1. Summarize your findings and send them to the lead.",
            "2. Stop working after sending your summary.",
          ].join("\n"),
        }).then(
          () => true,
          () => false,
        )
        if (!sent) {
          await Team.transitionMemberStatus(ctx.params.teamName, ctx.payload.member, "shutdown", { force: true })
          return "shutdown" as const
        }
        if (member.status === "busy") await Team.cancelMember(ctx.params.teamName, ctx.payload.member)
        return "shutdown_requested" as const
      })
      return { ok: true, status }
    })

    const cleanup = Effect.fn("TeamHttpApi.cleanup")(function* (ctx: { params: { teamName: string } }) {
      yield* runLegacyTeam(() => Team.cleanup(ctx.params.teamName))
      return { ok: true }
    })

    const message = Effect.fn("TeamHttpApi.message")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof TeamMessagePayload.Type
    }) {
      const match = yield* runLegacyTeam(() => Team.findBySession(ctx.params.sessionID))
      if (!match) return yield* new TeamApiError({ message: "Session is not part of a team" })
      yield* runLegacyTeam(() =>
        TeamMessaging.send({
          teamName: match.team.name,
          from: match.role === "lead" ? "lead" : (match.memberName ?? ctx.payload.agent ?? "member"),
          to: ctx.payload.to,
          text: ctx.payload.text,
        }),
      )
      return { ok: true }
    })

    return handlers
      .handle("list", list)
      .handle("get", get)
      .handle("tasks", tasks)
      .handle("bySession", bySession)
      .handle("delegate", delegate)
      .handle("cancel", cancel)
      .handle("approvePlan", approvePlan)
      .handle("shutdown", shutdown)
      .handle("cleanup", cleanup)
      .handle("message", message)
  }),
)

function delegateDenyRules(existing: PermissionV1.Ruleset) {
  return WRITE_TOOLS.filter(
    (tool) => !existing.some((rule) => rule.permission === tool && rule.pattern === "*" && rule.action === "deny"),
  ).map((tool) => ({ permission: tool, pattern: "*", action: "deny" as const }))
}
