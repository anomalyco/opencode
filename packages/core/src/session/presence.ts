export * as SessionPresence from "./presence.js"

import { Clock, Context, Duration, Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Session } from "@opencode/schema/session"
import { SessionStore } from "./store.js"

// A lease outlives the longest supported cache TTL (one hour) plus the fire margin and report
// cadence, so a client frozen just after a report still holds a lease when the timer fires.
const LEASE = Duration.hours(2)

export interface Interface {
  /** Replaces one client's open-tab set and refreshes its leases. Unknown and archived Sessions are ignored. */
  readonly report: (input: {
    readonly client: string
    readonly sessions: ReadonlyArray<Session.ID>
  }) => Effect.Effect<void>
  /** Whether any client holds an unexpired lease for a live, unarchived Session. */
  readonly present: (sessionID: Session.ID) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionPresence") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    // Ephemeral interest, never persisted: sessionID → client → lease expiry (epoch millis).
    const leases = new Map<Session.ID, Map<string, number>>()

    const report = Effect.fn("SessionPresence.report")(function* (input: {
      readonly client: string
      readonly sessions: ReadonlyArray<Session.ID>
    }) {
      const expiry = (yield* Clock.currentTimeMillis) + Duration.toMillis(LEASE)
      const valid = (yield* Effect.forEach(input.sessions, (sessionID) =>
        store.get(sessionID).pipe(Effect.map((info) => (info && !info.time.archived ? sessionID : undefined))),
      )).filter((sessionID): sessionID is Session.ID => sessionID !== undefined)

      for (const [sessionID, clients] of leases) {
        clients.delete(input.client)
        if (clients.size === 0) leases.delete(sessionID)
      }
      for (const sessionID of valid) {
        const clients = leases.get(sessionID) ?? new Map<string, number>()
        clients.set(input.client, expiry)
        leases.set(sessionID, clients)
      }
    })

    const present = Effect.fn("SessionPresence.present")(function* (sessionID: Session.ID) {
      const clients = leases.get(sessionID)
      if (!clients) return false
      const now = yield* Clock.currentTimeMillis
      if (![...clients.values()].some((expiry) => expiry > now)) {
        leases.delete(sessionID)
        return false
      }
      const info = yield* store.get(sessionID)
      return info !== undefined && !info.time.archived
    })

    return Service.of({ report, present })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [SessionStore.node],
})
