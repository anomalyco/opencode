import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { App } from "@opencode/core/app"
import { Flag } from "@opencode/core/flag"
import { Session } from "@opencode/core/session"
import { SessionTunnel } from "@opencode/core/session/tunnel"
import { AgentTunnel } from "@opencode/schema/agent-tunnel"
import { SessionEvent } from "@opencode/schema/session-event"
import { ServiceUnavailableError } from "@opencode/protocol/errors"
import { Effect, Option, Stream } from "effect"
import { ServerInfo } from "../server-info"
import { missingSession } from "./session-error"

/** `agentTunnel.*` in the `server.experimental` group. */
export const makeAgentTunnel = Effect.gen(function* () {
  const tunnel = yield* SessionTunnel.Service
  const bus = yield* Bus.Service

  // The experimental group runs without location middleware, so no ambient Config or App.Metadata
  // reaches these handlers. Resolve the flag per request from the server's channel, OPENCODE_FLAGS,
  // and a Config when one is in scope; config changes apply without a restart.
  const requireFlag = Effect.fn("AgentTunnelHandler.requireFlag")(function* () {
    const info = yield* ServerInfo.Service
    const overrides = yield* Flag.Overrides
    const config = yield* Effect.serviceOption(Config.Service)
    const entries = Option.isSome(config) ? yield* config.value.entries() : []
    const flags = Flag.resolve({ entries, channel: App.make(info.app).channel, overrides })
    if (flags.agent_tunnel.enabled) return
    return yield* new ServiceUnavailableError({
      message: 'The agent tunnel is disabled. Enable the "agent_tunnel" flag to read tunnel messages.',
      service: "agent-tunnel",
    })
  })

  return {
    list: Effect.fn("AgentTunnelHandler.list")(function* (query: { readonly sessionID: Session.ID; readonly after?: number }) {
      yield* requireFlag()
      return { data: yield* tunnel.list(query).pipe(Effect.catchTag("Session.NotFoundError", missingSession)) }
    }),
    log: Effect.fn("AgentTunnelHandler.log")(function* (query: {
      readonly sessionID: Session.ID
      readonly after?: number
      readonly follow?: boolean
    }) {
      yield* requireFlag()
      // Validate before streaming so a missing session is a 404, not a mid-stream failure.
      yield* tunnel.family(query.sessionID).pipe(Effect.catchTag("Session.NotFoundError", missingSession))
      return Stream.unwrap(
        Effect.gen(function* () {
          // Family membership is frozen at connect: sessions created later join only on reconnect.
          const family = new Set((yield* tunnel.family(query.sessionID).pipe(Effect.orDie)).map((member) => member.id))
          // Subscribe before the historical read, mirroring the session log: a message committed
          // during the replay either appears in the read or arrives through this subscription,
          // and the id set below keeps the overlap from yielding duplicates.
          const subscribe = yield* Stream.toPull(bus.subscribe(SessionEvent.TunnelSent))
          const replay = yield* tunnel
            .list({ sessionID: query.sessionID, after: query.after })
            .pipe(Effect.orDie)
          const seen = new Set(replay.map((message) => message.id))
          const live = Stream.fromPull(Effect.succeed(subscribe)).pipe(
            Stream.map((event) => {
              const message: AgentTunnel.Message = event.data.message
              if (!family.has(message.from.sessionID) && !family.has(message.to.sessionID)) return []
              if (seen.has(message.id)) return []
              seen.add(message.id)
              return [message]
            }),
            Stream.flattenIterable,
          )
          const synced = { type: "agent-tunnel.synced" as const, sessionID: query.sessionID }
          if (query.follow !== true) return Stream.fromIterable(replay).pipe(Stream.concat(Stream.make(synced)))
          return Stream.fromIterable(replay).pipe(Stream.concat(Stream.make(synced)), Stream.concat(live))
        }),
      )
    }),
  }
})
