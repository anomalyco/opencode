import { Schema } from "effect"
import { create } from "@/id/id"

const prefix = "sec"

export const SecureInputID = Schema.String.pipe(Schema.brand("SecureInputID"))
export type SecureInputID = typeof SecureInputID.Type

export function nextSecureInputID(id?: string): SecureInputID {
  if (id !== undefined) {
    if (!id.startsWith(prefix + "_")) throw new Error(`ID ${id} does not start with ${prefix}_`)
    return id as SecureInputID
  }
  return create(prefix, "ascending") as SecureInputID
}

export const SecureInputRequest = Schema.Struct({
  id: SecureInputID,
  sessionID: Schema.String,
  prompt: Schema.String,
  command: Schema.optional(Schema.String),
})
export type SecureInputRequest = Schema.Schema.Type<typeof SecureInputRequest>
