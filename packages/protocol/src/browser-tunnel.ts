export * as BrowserTunnelProtocol from "./browser-tunnel.js"

import { BrowserTunnel } from "@opencode-ai/schema/browser-tunnel"
import { Effect, Schema } from "effect"

export const Path = "/api/browser/tunnel"
export const Subprotocol = "opencode.browser.tunnel.v1"
export const MaxFrameBytes = 64 * 1_024
export const MaxHandshakeBytes = 16 * 1_024

class MessageError extends Schema.TaggedErrorClass<MessageError>()("BrowserTunnelProtocol.MessageError", {
  kind: Schema.Literals(["invalid", "too_large"]),
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { fatal: true })
const encodeClient = Schema.encodeSync(Schema.fromJsonString(BrowserTunnel.FromClient))
const encodeServer = Schema.encodeSync(Schema.fromJsonString(BrowserTunnel.FromServer))
const decodeClient = Schema.decodeUnknownEffect(Schema.fromJsonString(BrowserTunnel.FromClient), {
  errors: "all",
  onExcessProperty: "error",
})
const decodeServer = Schema.decodeUnknownEffect(Schema.fromJsonString(BrowserTunnel.FromServer), {
  errors: "all",
  onExcessProperty: "error",
})

export function encodeFromClient(input: BrowserTunnel.FromClient) {
  return encode(encodeClient(input))
}

export function encodeFromServer(input: BrowserTunnel.FromServer) {
  return encode(encodeServer(input))
}

function encode(input: string) {
  if (encoder.encode(input).byteLength > MaxHandshakeBytes) {
    throw new RangeError(`Browser tunnel handshake must not exceed ${MaxHandshakeBytes} bytes.`)
  }
  return input
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
  if ((typeof input === "string" ? encoder.encode(input).byteLength : input.byteLength) > MaxHandshakeBytes) {
    return Effect.fail(new MessageError({ kind: "too_large", message: "Browser tunnel handshake is too large." }))
  }
  const text =
    typeof input === "string"
      ? Effect.succeed(input)
      : Effect.try({
          try: () => decoder.decode(input),
          catch: (cause) => new MessageError({ kind: "invalid", message: "Invalid tunnel handshake UTF-8.", cause }),
        })
  return text.pipe(
    Effect.flatMap(decodeMessage),
    Effect.mapError((cause) =>
      cause instanceof MessageError
        ? cause
        : new MessageError({ kind: "invalid", message: "Browser tunnel handshake is invalid.", cause }),
    ),
  )
}
