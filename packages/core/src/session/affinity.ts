export * as SessionAffinity from "./affinity.js"

import type { SessionSchema } from "./schema.js"

// TODO: Should the `model.request` hook expose affinity so plugins stop deriving it from `ctx.session.get`?
/** The Session ID that groups model requests for provider cache routing: children share the parent's, forks the fork source's. */
export const get = (session: Pick<SessionSchema.Info, "id" | "parentID" | "fork">) =>
  session.parentID ?? session.fork?.sessionID ?? session.id
