export * as BrowserControlProtocol from "./browser-control.js"

import { BrowserControl } from "@opencode-ai/schema/browser-control"
import { Effect, Schema } from "effect"

export const Path = "/api/browser/control"
export const Subprotocol = "opencode.browser.control.v1"
export const MaxMessageBytes = 8 * 1_024 * 1_024

class MessageError extends Schema.TaggedErrorClass<MessageError>()("BrowserControlProtocol.MessageError", {
  kind: Schema.Literals(["invalid", "too_large"]),
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

const decoder = new TextDecoder("utf-8", { fatal: true })
const encoder = new TextEncoder()
const encodeClient = Schema.encodeSync(Schema.fromJsonString(BrowserControl.FromClient))
const encodeServer = Schema.encodeSync(Schema.fromJsonString(BrowserControl.FromServer))
const decodeClient = Schema.decodeUnknownEffect(Schema.fromJsonString(BrowserControl.FromClient), {
  errors: "all",
  onExcessProperty: "error",
})
const decodeServer = Schema.decodeUnknownEffect(Schema.fromJsonString(BrowserControl.FromServer), {
  errors: "all",
  onExcessProperty: "error",
})

export function encodeFromClient(input: BrowserControl.FromClient) {
  return encode(input, encodeClient)
}

export function encodeFromServer(input: BrowserControl.FromServer) {
  return encode(input, encodeServer)
}

function encode<Message>(input: Message, encodeMessage: (input: Message) => string) {
  const output = encodeMessage(input)
  if (encoder.encode(output).byteLength > MaxMessageBytes) {
    throw new RangeError(`Browser control message must not exceed ${MaxMessageBytes} bytes.`)
  }
  return output
}

export function decodeFromClient(input: string | Uint8Array) {
  return decode(input, decodeClient)
}

export function decodeFromServer(input: string | Uint8Array) {
  return decode(input, decodeServer)
}

function decode<Message>(
  input: string | Uint8Array,
  decodeMessage: (input: unknown) => Effect.Effect<Message, unknown>,
): Effect.Effect<Message, MessageError> {
  if (typeof input === "string" && encoder.encode(input).byteLength > MaxMessageBytes) {
    return Effect.fail(new MessageError({ kind: "too_large", message: "Browser control message is too large." }))
  }
  if (typeof input !== "string" && input.byteLength > MaxMessageBytes) {
    return Effect.fail(new MessageError({ kind: "too_large", message: "Browser control message is too large." }))
  }
  const text =
    typeof input === "string"
      ? Effect.succeed(input)
      : Effect.try({
          try: () => decoder.decode(input),
          catch: (cause) =>
            new MessageError({ kind: "invalid", message: "Browser control message is not valid UTF-8.", cause }),
        })
  return text.pipe(
    Effect.flatMap(decodeMessage),
    Effect.mapError((cause) =>
      cause instanceof MessageError
        ? cause
        : new MessageError({ kind: "invalid", message: "Browser control message is invalid.", cause }),
    ),
  )
}
