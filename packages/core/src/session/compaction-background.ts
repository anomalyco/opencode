export * as SessionCompactionBackground from "./compaction-background.js"

import { Effect, Option, Schema } from "effect"
import type { Job } from "../job.js"
import { OutstandingItem } from "../job/recovery.js"
import { SessionBackground } from "./background.js"
import type { SessionMessage } from "./message.js"
import type { SessionSchema } from "./schema.js"
import { SubagentCompletion } from "./subagent-completion.js"

/** The most running jobs one checkpoint lists. The rest still report back when they finish. */
export const MAX = 20

const decode = Schema.decodeUnknownOption(Schema.Array(OutstandingItem))

/**
 * The session's own running background jobs for compaction metadata. Subagents are listed by
 * `SessionCompactionSubagents`, and work running in a subagent belongs to that subagent.
 */
export const collect = Effect.fnUntraced(function* (
  jobs: Pick<Job.Interface, "runningBackground">,
  store: SessionBackground.Lookup,
  sessionID: SessionSchema.ID,
) {
  return (yield* SessionBackground.outstanding(jobs, store, sessionID))
    .filter((item) => item.kind !== "subagent" && item.sessionID === sessionID)
    .slice(0, MAX)
})

/** Explains the `<background-work>` block. The tag holds only the list, so this goes beside it. */
export const NOTE =
  "<background-work> lists this session's background jobs that were running when this checkpoint was written; each sends a <background-result> when it finishes."

/** Renders the `<background-work>` checkpoint block, or an empty string when nothing was running. */
export const format = (message: SessionMessage.CompactionCompleted) => {
  const items = Option.getOrElse(decode(message.metadata?.background), () => [])
  if (items.length === 0) return ""
  return [
    "<background-work>",
    // Every item ran in the compacting session, so no line names its session.
    ...items.map((item) => SubagentCompletion.line(item, item.sessionID)),
    "</background-work>",
  ].join("\n")
}
