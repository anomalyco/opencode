export * as SessionMessageRow from "./message-row"

import { Schema } from "effect"
import { SessionMessage } from "./message"
import type { SessionMessageTable } from "./sql"

export type Representation = Pick<typeof SessionMessageTable.$inferSelect, "id" | "type" | "data">

const decodeMessage = Schema.decodeUnknownEffect(SessionMessage.Info)
const decodeMessageSync = Schema.decodeUnknownSync(SessionMessage.Info)
const encodeMessage = Schema.encodeSync(SessionMessage.Info)

export const decode = (row: Representation) => decodeMessage({ ...row.data, id: row.id, type: row.type })

export const decodeSync = (row: Representation) => decodeMessageSync({ ...row.data, id: row.id, type: row.type })

export function encode(message: SessionMessage.Info): Representation {
  const { id, type, ...data } = encodeMessage(message)
  return { id: SessionMessage.ID.make(id), type, data }
}
