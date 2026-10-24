export * as SessionRecord from "./record.js"

import { Effect, Option, Schema } from "effect"

const Checkpoint = Schema.Struct({ hash: Schema.String, claudeMessageID: Schema.optional(Schema.String) })
export type Checkpoint = typeof Checkpoint.Type
const Record = Schema.Struct({
  claudeSessionID: Schema.String,
  // The ID is saved even when a step is cancelled or fails; only a completed step saves history.
  history: Schema.optional(Schema.Array(Checkpoint)),
})
export type Record = typeof Record.Type

export interface Storage {
  readonly get: (key: string) => Effect.Effect<unknown>
  readonly set: (key: string, value: Record) => Effect.Effect<void>
}

export function make(storage: Storage) {
  return {
    get: Effect.fn("SessionRecord.get")(function* (sessionID: string) {
      const saved = Schema.decodeUnknownOption(Record)(yield* storage.get(`sessions/${sessionID}`))
      return Option.getOrUndefined(saved)
    }),
    set: (sessionID: string, record: Record) => storage.set(`sessions/${sessionID}`, record),
  }
}
