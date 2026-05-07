import { Cause, Context, Effect, Queue, Stream } from "effect"
import { Headers } from "effect/unstable/http"
import { LLMError, TransportReason } from "../../schema"

export interface WebSocketRequest {
  readonly url: string
  readonly headers: Headers.Headers
}

export interface WebSocketConnection {
  readonly sendText: (message: string) => Effect.Effect<void, LLMError>
  readonly messages: Stream.Stream<string | Uint8Array, LLMError>
  readonly close: Effect.Effect<void, never>
}

export interface Interface {
  readonly open: (input: WebSocketRequest) => Effect.Effect<WebSocketConnection, LLMError>
}

type WebSocketConstructorWithHeaders = new (
  url: string,
  options?: { readonly headers?: Headers.Headers },
) => globalThis.WebSocket

export class Service extends Context.Service<Service, Interface>()("@opencode/LLM/WebSocketExecutor") {}

const transportError = (method: string, message: string, input: { readonly url?: string; readonly kind?: string } = {}) =>
  new LLMError({
    module: "WebSocketExecutor",
    method,
    reason: new TransportReason({ message, url: input.url, kind: input.kind }),
  })

const eventMessage = (event: Event) => {
  if ("message" in event && typeof event.message === "string") return event.message
  return event.type
}

const binaryMessage = (data: unknown) => {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return undefined
}

const waitOpen = (ws: globalThis.WebSocket, input: WebSocketRequest) => {
  if (ws.readyState === globalThis.WebSocket.OPEN) return Effect.void
  if (ws.readyState === globalThis.WebSocket.CLOSING || ws.readyState === globalThis.WebSocket.CLOSED) {
    return Effect.fail(transportError("open", `WebSocket closed before opening (state ${ws.readyState})`, { url: input.url, kind: "open" }))
  }
  return Effect.callback<void, LLMError>((resume) => {
    const cleanup = () => {
      ws.removeEventListener("open", onOpen)
      ws.removeEventListener("error", onError)
      ws.removeEventListener("close", onClose)
    }
    const onOpen = () => {
      cleanup()
      resume(Effect.void)
    }
    const onError = (event: Event) => {
      cleanup()
      resume(Effect.fail(transportError("open", `Failed to open WebSocket: ${eventMessage(event)}`, { url: input.url, kind: "open" })))
    }
    const onClose = (event: CloseEvent) => {
      cleanup()
      resume(Effect.fail(transportError("open", `WebSocket closed before opening with code ${event.code}`, { url: input.url, kind: "open" })))
    }
    ws.addEventListener("open", onOpen, { once: true })
    ws.addEventListener("error", onError, { once: true })
    ws.addEventListener("close", onClose, { once: true })
  })
}

export const open = (input: WebSocketRequest) =>
  Effect.try({
    try: () => new (globalThis.WebSocket as unknown as WebSocketConstructorWithHeaders)(input.url, { headers: input.headers }),
    catch: (error) => transportError("open", error instanceof Error ? error.message : "Failed to construct WebSocket", { url: input.url, kind: "open" }),
  }).pipe(Effect.flatMap((ws) => fromWebSocket(ws, input)))

export const fromWebSocket = (ws: globalThis.WebSocket, input: WebSocketRequest): Effect.Effect<WebSocketConnection, LLMError> =>
  Effect.gen(function* () {
    yield* waitOpen(ws, input)
    const messages = yield* Queue.bounded<string | Uint8Array, LLMError | Cause.Done<void>>(128)

    const onMessage = (event: MessageEvent) => {
      if (typeof event.data === "string") return Queue.offerUnsafe(messages, event.data)
      const binary = binaryMessage(event.data)
      if (binary) return Queue.offerUnsafe(messages, binary)
      Queue.failCauseUnsafe(messages, Cause.fail(transportError("message", "Unsupported WebSocket message payload", { url: input.url, kind: "message" })))
    }
    const onError = (event: Event) => {
      Queue.failCauseUnsafe(messages, Cause.fail(transportError("message", `WebSocket error: ${eventMessage(event)}`, { url: input.url, kind: "message" })))
    }
    const onClose = (event: CloseEvent) => {
      if (event.code === 1000 || event.code === 1005) return Queue.endUnsafe(messages)
      Queue.failCauseUnsafe(messages, Cause.fail(transportError("message", `WebSocket closed with code ${event.code}`, { url: input.url, kind: "close" })))
    }
    const cleanup = Effect.sync(() => {
      ws.removeEventListener("message", onMessage)
      ws.removeEventListener("error", onError)
      ws.removeEventListener("close", onClose)
    }).pipe(Effect.andThen(Queue.shutdown(messages)))

    ws.addEventListener("message", onMessage)
    ws.addEventListener("error", onError)
    ws.addEventListener("close", onClose)

    return {
      sendText: (message) =>
        Effect.try({
          try: () => ws.send(message),
          catch: (error) =>
            transportError("sendText", error instanceof Error ? error.message : "Failed to send WebSocket message", { url: input.url, kind: "write" }),
        }),
      messages: Stream.fromQueue(messages),
      close: cleanup.pipe(Effect.andThen(Effect.sync(() => {
        if (ws.readyState === globalThis.WebSocket.CLOSED || ws.readyState === globalThis.WebSocket.CLOSING) return
        ws.close(1000)
      }))),
    }
  })

export const WebSocketExecutor = {
  Service,
  open,
  fromWebSocket,
} as const
