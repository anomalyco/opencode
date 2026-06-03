export * as ToolProgress from "./tool-progress"

import { DateTime, Effect } from "effect"
import { EventV2 } from "../event"
import { SessionEvent } from "./event"
import { SessionSchema } from "./schema"

export type Owner = {
  readonly sessionID: SessionSchema.ID
  readonly assistantMessageID: EventV2.ID
  readonly callID: string
}

export type Update = Pick<SessionEvent.Tool.Progress["data"], "structured" | "content">

/**
 * Bind progress publication only where the real owning assistant and tool-call
 * identities are available. `live` is ephemeral connected-client state and
 * never advances the aggregate cursor. `checkpoint` is a replayable full-value
 * durability boundary. Tools should checkpoint semantic transitions or a
 * bounded cadence, not every output chunk.
 */
export const create = (events: EventV2.Interface, owner: Owner) => {
  const withTimestamp = (update: Update) =>
    DateTime.now.pipe(Effect.map((timestamp) => ({ ...owner, ...update, timestamp })))

  return {
    live: (update: Update) => withTimestamp(update).pipe(Effect.flatMap((data) => events.publish(SessionEvent.Tool.ProgressLive, data))),
    checkpoint: (update: Update) => withTimestamp(update).pipe(Effect.flatMap((data) => events.publish(SessionEvent.Tool.Progress, data))),
  }
}
