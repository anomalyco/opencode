import { Effect } from "effect"
import type { Session } from "@opencode-ai/schema/session"
import type { Location } from "@opencode-ai/schema/location"
import { Permission } from "../permission.js"

/**
 * Run a permission op against the Permission instance owning the session.
 *
 * Permission state is location-scoped while sessions (and their events) are
 * global: a request asked in another directory pends in that location's
 * instance, invisible to the caller's own `permission` service (whose lookup
 * then fails "not found"). Resolve the session's location first and use that
 * instance instead, like the HTTP session-location middleware does. Sessions
 * that no longer resolve fall back to the ambient instance (legacy behavior).
 */
export function permissionForSession<A, E>(input: {
  sessions: {
    get: (sessionID: Session.ID) => Effect.Effect<{ readonly location: Location.Ref }, unknown>
  }
  scoped: (ref: Location.Ref) => Effect.Effect<Permission.Interface, never, never>
  ambient: Permission.Interface
  sessionID: Session.ID
  use: (permission: Permission.Interface) => Effect.Effect<A, E, never>
}): Effect.Effect<A, E, never> {
  return Effect.flatMap(
    input.sessions.get(input.sessionID).pipe(Effect.orElseSucceed(() => undefined)),
    (session) =>
      session === undefined
        ? input.use(input.ambient)
        : Effect.flatMap(input.scoped(session.location), input.use),
  )
}
