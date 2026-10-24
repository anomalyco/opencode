export * as SessionAffinity from "./affinity.js"

import { Effect } from "effect"
import type { SessionSchema } from "./schema.js"

// TODO: Should the `model.request` hook expose affinity so plugins stop deriving it from `ctx.session.get`?
/**
 * The Session ID that groups model requests for provider cache routing: the root reached through parents and fork
 * sources, so children, forks, and forks of forks share one key. A Session that cannot be loaded ends the walk.
 */
export const get = Effect.fnUntraced(function* (
  sessionID: SessionSchema.ID,
  load: (sessionID: SessionSchema.ID) => Effect.Effect<Pick<SessionSchema.Info, "parentID" | "fork"> | undefined>,
) {
  let current = sessionID
  while (true) {
    const session = yield* load(current)
    const source = session?.parentID ?? session?.fork?.sessionID
    if (source === undefined) return current
    current = source
  }
})
