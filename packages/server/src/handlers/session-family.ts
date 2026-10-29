import { Form } from "@opencode/core/form"
import { Instance } from "@opencode/core/instance/service"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { Effect } from "effect"
import { missingSession } from "./session-error"

/** `sessionFamily.get` in the `server.experimental` group. */
export const makeSessionFamily = Effect.gen(function* () {
  const session = yield* Session.Service
  const instances = yield* Instance.Service
  return Effect.fn(function* (sessionID: Session.ID) {
    const family = yield* session.family(sessionID).pipe(Effect.catchTag("Session.NotFoundError", missingSession))
    // Pending requests live in memory, so only a running Location can hold one. A member whose Location
    // is not running contributes nothing and is neither started nor waited on. If one is invalidated after
    // `live`, `provide` restarts it; a missing directory then contributes nothing, other failures are defects.
    const none = [[], []] as const
    const pending = yield* Effect.forEach(
      family.sessions,
      Effect.fnUntraced(function* (member) {
        if (instances.live && !(yield* instances.live(member))) return none
        return yield* Effect.all([
          Permission.Service.use((permission) => permission.forSession(member.id)),
          Form.Service.use((form) => form.list({ sessionID: member.id })),
        ]).pipe(
          instances.provide(member),
          Effect.orElseSucceed(() => none),
        )
      }),
      { concurrency: 8 },
    )
    return {
      data: {
        rootID: family.rootID,
        sessions: family.sessions,
        permissions: pending.flatMap((requests) => requests[0]),
        forms: pending.flatMap((requests) => requests[1]),
      },
    }
  })
})
