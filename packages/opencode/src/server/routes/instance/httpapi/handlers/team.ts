import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceState } from "@/effect/instance-state"
import { Permission } from "@/permission"
import { Instance } from "@/project/instance"
import { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { Team, TeamTasks, WRITE_TOOLS } from "@/team"
import { TeamMessaging } from "@/team/messaging"
import { InstanceHttpApi } from "../api"
import { TeamApiError, TeamCancelPayload, TeamDelegatePayload, TeamMessagePayload } from "../groups/team"

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

export const teamHandlers = HttpApiBuilder.group(InstanceHttpApi, "team", (handlers) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service

    const bySession = Effect.fn("TeamHttpApi.bySession")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
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
      if (!team) return yield* new TeamApiError({ message: `Team "${ctx.params.teamName}" not found` })

      const leadSessionID = SessionID.make(team.leadSessionID)
      const current = yield* sessions.get(leadSessionID).pipe(
        Effect.mapError(() => new TeamApiError({ message: `Lead session "${team.leadSessionID}" not found` })),
      )
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
      .handle("bySession", bySession)
      .handle("delegate", delegate)
      .handle("cancel", cancel)
      .handle("message", message)
  }),
)

function delegateDenyRules(existing: PermissionV1.Ruleset) {
  return WRITE_TOOLS.filter(
    (tool) =>
      !existing.some((rule) => rule.permission === tool && rule.pattern === "*" && rule.action === "deny"),
  ).map((tool) => ({ permission: tool, pattern: "*", action: "deny" as const }))
}
