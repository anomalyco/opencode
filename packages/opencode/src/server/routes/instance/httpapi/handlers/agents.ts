import * as AgentPresence from "@/agent/presence"
import { InstanceState } from "@/effect/instance-state"
import { Loop } from "@/loop/loop"
import { Permission } from "@/permission"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

const instanceID = () => process.env.OPENCODE_INSTANCE_ID ?? `${process.pid}`

export const agentsHandlers = HttpApiBuilder.group(InstanceHttpApi, "agents", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    const status = yield* SessionStatus.Service
    const permission = yield* Permission.Service
    const loop = yield* Loop.Service

    const list = Effect.fn("AgentsHttpApi.list")(function* () {
      const [ctx, sessions, statuses, permissions, loops] = yield* Effect.all([
        InstanceState.context,
        session.list(),
        status.list(),
        permission.list(),
        loop.list(),
      ])
      const byID = new Map(sessions.map((item) => [item.id, item]))
      const bySession = new Map<string, Loop.Info>()
      for (const item of loops) bySession.set(item.sessionID, item)
      const pending = new Set(permissions.map((item) => item.sessionID))
      const now = Date.now()
      const result = new Map<string, AgentPresence.Info>()

      for (const [sessionID, sessionStatus] of statuses) {
        const info = byID.get(sessionID)
        if (!info) continue
        const currentLoop = bySession.get(sessionID)
        const record: AgentPresence.Info = {
          owner: "opencode-skein",
          instanceID: instanceID(),
          sessionID,
          ...(currentLoop
            ? { loopID: currentLoop.id, loopStatus: currentLoop.status, loopIteration: currentLoop.iteration }
            : {}),
          directory: info.directory,
          ...(info.agent ? { agent: info.agent } : {}),
          ...(info.model ? { provider: info.model.providerID, model: info.model.id } : {}),
          status: AgentPresence.statusFrom({
            session: sessionStatus,
            permissionPending: pending.has(sessionID),
            loop: currentLoop,
          }),
          lastEventAt: info.time.updated,
          heartbeatAt: now,
          canPrompt: true,
          canBtw: true,
          canAbort: sessionStatus.type !== "idle",
        }
        result.set(sessionID, record)
      }

      // Paused loops may have an idle session status, but remain important to
      // the Supervisor roster and must not disappear from presence.
      for (const currentLoop of loops) {
        if (result.has(currentLoop.sessionID)) continue
        const info = byID.get(currentLoop.sessionID)
        if (
          !info ||
          !AgentPresence.isActive({
            owner: "opencode-skein",
            instanceID: instanceID(),
            sessionID: currentLoop.sessionID,
            loopID: currentLoop.id,
            directory: info.directory,
            status: AgentPresence.statusFrom({ session: undefined, permissionPending: false, loop: currentLoop }),
            loopStatus: currentLoop.status,
            loopIteration: currentLoop.iteration,
            lastEventAt: info.time.updated,
            heartbeatAt: now,
            canPrompt: true,
            canBtw: true,
            canAbort: false,
          })
        )
          continue
        result.set(currentLoop.sessionID, {
          owner: "opencode-skein",
          instanceID: instanceID(),
          sessionID: currentLoop.sessionID,
          loopID: currentLoop.id,
          loopStatus: currentLoop.status,
          loopIteration: currentLoop.iteration,
          directory: info.directory,
          ...(info.agent ? { agent: info.agent } : {}),
          ...(info.model ? { provider: info.model.providerID, model: info.model.id } : {}),
          status: AgentPresence.statusFrom({ session: undefined, permissionPending: false, loop: currentLoop }),
          lastEventAt: info.time.updated,
          heartbeatAt: now,
          canPrompt: true,
          canBtw: true,
          canAbort: false,
        })
      }

      return [...result.values()]
    })

    return handlers.handle("list", list)
  }),
)
