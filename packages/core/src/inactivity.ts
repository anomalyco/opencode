export * as Inactivity from "./inactivity.js"

import { Clock, Context, Effect, Layer, Scope } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import type { Location } from "@opencode/schema/location"
import type { SessionSchema } from "./session/schema.js"

type Owner =
  | { readonly sessionID: SessionSchema.ID; readonly location?: Location.Ref }
  | { readonly sessionID?: undefined; readonly location: Location.Ref }
type Activity = { since: number; working: number }

/** One process-local inactivity policy for Sessions and their shared Location resources. */
export class Service extends Context.Service<
  Service,
  {
    /** Record progress or human input, without borrowing a Location graph. */
    readonly touch: (owner: Owner) => Effect.Effect<void>
    /** Owned work prevents expiration until its scope closes, then starts a fresh idle window. */
    readonly hold: (owner: Owner) => Effect.Effect<void, never, Scope.Scope>
    /** Find expired live executions and cached graphs; prune observations that no longer have owners. */
    readonly expired: (input: {
      readonly sessions: ReadonlySet<SessionSchema.ID>
      readonly locations: readonly Location.Ref[]
      readonly timeToLive: number
    }) => Effect.Effect<{ sessions: SessionSchema.ID[]; locations: Location.Ref[] }>
  }
>()("@opencode/Inactivity") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const clock = yield* Clock.Clock
    const sessions = new Map<SessionSchema.ID, Activity>()
    const locations = new Map<string, Activity>()
    const key = (ref: Location.Ref) => `${ref.directory}\0${ref.workspaceID ?? ""}`
    const entries = (owner: Owner) => {
      const session = owner.sessionID
        ? (sessions.get(owner.sessionID) ?? { since: clock.currentTimeMillisUnsafe(), working: 0 })
        : undefined
      const location = owner.location
        ? (locations.get(key(owner.location)) ?? { since: clock.currentTimeMillisUnsafe(), working: 0 })
        : undefined
      if (session && owner.sessionID) sessions.set(owner.sessionID, session)
      if (location && owner.location) locations.set(key(owner.location), location)
      return [session, location].flatMap((entry) => (entry ? [entry] : []))
    }
    return Service.of({
      touch: (owner) =>
        Effect.sync(() => entries(owner).forEach((entry) => (entry.since = clock.currentTimeMillisUnsafe()))),
      hold: (owner) =>
        Effect.acquireRelease(
          Effect.sync(() =>
            entries(owner).map((entry) => {
              entry.working++
              return entry
            }),
          ),
          (held) =>
            Effect.sync(() =>
              held.forEach((entry) => {
                entry.working--
                entry.since = clock.currentTimeMillisUnsafe()
              }),
            ),
        ).pipe(Effect.asVoid),
      expired: (input) =>
        Effect.sync(() => {
          input.sessions.forEach((sessionID) => entries({ sessionID }))
          input.locations.forEach((location) => entries({ location }))
          sessions.forEach((entry, id) => {
            if (!input.sessions.has(id) && entry.working === 0) sessions.delete(id)
          })
          const cached = new Set(input.locations.map(key))
          locations.forEach((entry, id) => {
            if (!cached.has(id) && entry.working === 0) locations.delete(id)
          })
          const idle = (entry: Activity | undefined) =>
            entry !== undefined &&
            entry.working === 0 &&
            entry.since + input.timeToLive <= clock.currentTimeMillisUnsafe()
          return {
            sessions: Array.from(input.sessions).filter((id) => idle(sessions.get(id))),
            locations: input.locations.filter((ref) => idle(locations.get(key(ref)))),
          }
        }),
    })
  }),
)

/** Shared lifetime accounting; never recovered from durable "running" markers. */
export const node = makeGlobalNode({ service: Service, layer, deps: [] })
