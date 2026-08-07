export * as SessionMessagesCursor from "./session-messages-cursor.js"

import { Effect, Encoding, Result, Schema } from "effect"
import { SessionMessage } from "./session-message.js"

/**
 * Shared session message pagination cursor. Lives in schema so the protocol
 * message handler and the core plugin host paginate identically. The encoded
 * cursor carries the page order, so a cursor cannot be combined with an
 * explicit order.
 */

export const DefaultLimit = 50

export const Order = Schema.Literals(["asc", "desc"])
export type Order = typeof Order.Type

const Payload = Schema.Struct({
  id: SessionMessage.ID,
  order: Order,
  direction: Schema.Literals(["previous", "next"]),
})
export type Payload = typeof Payload.Type

const PayloadJson = Schema.fromJsonString(Payload)
const encodePayload = Schema.encodeSync(PayloadJson)
const decodePayload = Schema.decodeUnknownEffect(PayloadJson)
const invalidCursor = "Invalid cursor" as const

export const make = (input: Payload) => Encoding.encodeBase64Url(encodePayload(input))

export const parse = (input: string) =>
  Effect.suspend(() => {
    const result = Encoding.decodeBase64UrlString(input)
    return Result.isFailure(result)
      ? Effect.fail(invalidCursor)
      : decodePayload(result.success).pipe(Effect.mapError(() => invalidCursor))
  })

/** previous/next cursors for one returned page of messages. */
export const page = (data: ReadonlyArray<SessionMessage.Info>, order: Order) => {
  const first = data[0]
  const last = data.at(-1)
  return {
    previous: first ? make({ id: first.id, order, direction: "previous" }) : undefined,
    next: last ? make({ id: last.id, order, direction: "next" }) : undefined,
  }
}
