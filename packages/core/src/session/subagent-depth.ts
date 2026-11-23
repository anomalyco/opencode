export * as SubagentDepth from "./subagent-depth.js"

import { Effect } from "effect"
import { Config } from "../config.js"
import type { Session } from "../session.js"
import type { SessionSchema } from "./schema.js"

/** The configured limit if another generation of children would exceed it. */
export const reached = Effect.fnUntraced(function* (
  parent: SessionSchema.Info,
  sessions: Session.Interface,
  config: Config.Interface,
) {
  const limit = Config.latest(yield* config.entries(), "experimental")?.subagent_depth ?? 1
  let current = parent
  for (let depth = 0; depth < limit; depth++) {
    if (!current.parentID) return undefined
    current = yield* sessions.get(current.parentID)
  }
  return limit
})
