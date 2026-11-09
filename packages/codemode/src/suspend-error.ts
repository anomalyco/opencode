import { Schema } from "effect"
import type { Snapshot } from "./vm/snapshot/snapshot.js"

/**
 * A suspend that failed, leaving the run running: `running` names each host call that blocked it by its key and its
 * path (`tools.x.y`, `search`, or an extension function's path such as `fetch`). Empty when the state couldn't be
 * saved or was too large.
 */
export class SuspendError extends Schema.TaggedError<SuspendError>()("SuspendError", {
  message: Schema.String,
  running: Schema.Array(Schema.Struct({ key: Schema.String, path: Schema.String })),
}) {}

export class SnapshotError extends Error {
  override readonly name = "SnapshotError"
}

/** A snapshot as bytes: UTF-8 JSON. */
export const toBytes = (snapshot: Snapshot): Uint8Array => new TextEncoder().encode(JSON.stringify(snapshot))

/** Reads bytes `toBytes` wrote; `restore` checks what they hold. */
export const fromBytes = (bytes: Uint8Array): unknown => {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch (error) {
    throw new SnapshotError(`Invalid snapshot: the bytes are not UTF-8 JSON (${String(error)}).`)
  }
}
