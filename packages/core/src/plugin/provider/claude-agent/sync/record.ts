export * as SessionRecord from "./record.js"

import { Effect, Option, Schema } from "effect"

const Checkpoint = Schema.Struct({ hash: Schema.String, claudeMessageID: Schema.optional(Schema.String) })
export type Checkpoint = typeof Checkpoint.Type
const Record = Schema.Struct({
  claudeSessionID: Schema.String,
  history: Schema.optional(Schema.Array(Checkpoint)),
  // After cancellation, Claude owns the partial reply; history ends at the input it received.
  interrupted: Schema.optional(Schema.Boolean),
})
export type Record = typeof Record.Type

export interface Storage {
  readonly get: (key: string) => Effect.Effect<unknown>
  readonly set: (key: string, value: Record) => Effect.Effect<void>
  readonly remove: (key: string) => Effect.Effect<void>
  readonly scan: (options: { readonly prefix: string }) => Effect.Effect<{
    readonly entries: readonly { readonly key: string }[]
  }>
}

export function make(storage: Storage) {
  return {
    get: Effect.fn("SessionRecord.get")(function* (sessionID: string, configDir?: string) {
      const saved = Schema.decodeUnknownOption(Record)(yield* storage.get(key(sessionID, configDir)))
      return Option.getOrUndefined(saved)
    }),
    set: (sessionID: string, record: Record, configDir?: string) => storage.set(key(sessionID, configDir), record),
    remove: Effect.fn("SessionRecord.remove")(function* (sessionID: string) {
      yield* storage.remove(key(sessionID))
      const folders = yield* storage.scan({ prefix: `${key(sessionID)}:` })
      for (const entry of folders.entries) yield* storage.remove(entry.key)
    }),
  }
}

// Each Claude config folder has its own transcripts, so a chat keeps one record per folder.
function key(sessionID: string, configDir?: string) {
  return configDir ? `sessions/${sessionID}:${configDir}` : `sessions/${sessionID}`
}
