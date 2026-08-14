import { Cause, Context, Effect, Layer, Queue, Stream } from "effect"
import { Headers } from "effect/unstable/http"
import { AIError, TransportReason, type TransportOperation } from "../../schema/index.js"
import * as HttpTransport from "./http.js"
import type { Transport } from "./index.js"

export interface WebSocketRequest {
  readonly url: string
  readonly headers: Headers.Headers
}

export interface WebSocketConnection {
  readonly sendText: (message: string) => Effect.Effect<void, AIError>
  readonly messages: Stream.Stream<string | Uint8Array, AIError>
  readonly close: Effect.Effect<void, never>
}

export interface Interface {
  readonly open: (input: WebSocketRequest) => Effect.Effect<WebSocketConnection, AIError>
}

type WebSocketConstructorWithHeaders = new (
  url: string,
  options?: { readonly headers?: Headers.Headers },
) => globalThis.WebSocket

export class Service extends Context.Service<Service, Interface>()("@opencode/AI/WebSocketExecutor") {}

const MAX_FRAME_BYTES = 16 * 1024 * 1024

const transportError = (
  method: string,
  message: string,
  input: {
    readonly operation: TransportOperation
    readonly url?: string
    readonly code?: string
    readonly phase?: TransportReason["phase"]
    readonly delivery?: TransportReason["delivery"]
  },
) =>
  new AIError({
    module: "WebSocketExecutor",
    method,
    reason: new TransportReason({
      message,
      transport: "websocket",
      operation: input.operation,
      url: input.url,
      code: input.code,
      phase: input.phase,
      delivery: input.delivery,
    }),
  })

const annotateTransportError = (
  error: AIError,
  input: { readonly phase: TransportReason["phase"]; readonly delivery: TransportReason["delivery"] },
) =>
  error.reason._tag === "Transport"
    ? new AIError({
        module: error.module,
        method: error.method,
        reason: new TransportReason({
          message: error.reason.message,
          transport: error.reason.transport,
          operation: error.reason.operation,
          code: error.reason.code,
          url: error.reason.url,
          http: error.reason.http,
          phase: input.phase,
          delivery: input.delivery,
          recovery: error.reason.recovery,
        }),
      })
    : error

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
    return Effect.fail(
      transportError("open", `WebSocket closed before opening (state ${ws.readyState})`, {
        url: input.url,
        operation: "request",
        code: "closed",
        phase: "connect",
        delivery: "not-sent",
      }),
    )
  }
  return Effect.callback<void, AIError>((resume, signal) => {
    const cleanup = () => {
      ws.removeEventListener("open", onOpen)
      ws.removeEventListener("error", onError)
      ws.removeEventListener("close", onClose)
      signal.removeEventListener("abort", onAbort)
    }
    const onAbort = () => {
      cleanup()
      if (ws.readyState !== globalThis.WebSocket.CLOSED && ws.readyState !== globalThis.WebSocket.CLOSING)
        ws.close(1000)
    }
    const onOpen = () => {
      cleanup()
      resume(Effect.void)
    }
    const onError = (event: Event) => {
      cleanup()
      resume(
        Effect.fail(
          transportError("open", `Failed to open WebSocket: ${eventMessage(event)}`, {
            url: input.url,
            operation: "request",
            phase: "connect",
            delivery: "not-sent",
          }),
        ),
      )
    }
    const onClose = (event: CloseEvent) => {
      cleanup()
      resume(
        Effect.fail(
          transportError("open", `WebSocket closed before opening with code ${event.code}`, {
            url: input.url,
            operation: "request",
            code: String(event.code),
            phase: "connect",
            delivery: "not-sent",
          }),
        ),
      )
    }
    ws.addEventListener("open", onOpen, { once: true })
    ws.addEventListener("error", onError, { once: true })
    ws.addEventListener("close", onClose, { once: true })
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

const webSocketUrl = (value: string) =>
  Effect.try({
    try: () => {
      const url = new URL(value)
      if (url.protocol === "https:") {
        url.protocol = "wss:"
        return url.toString()
      }
      if (url.protocol === "http:") {
        url.protocol = "ws:"
        return url.toString()
      }
      throw new Error(`Unsupported WebSocket URL protocol ${url.protocol}`)
    },
    catch: (error) =>
      transportError("prepare", error instanceof Error ? error.message : "Invalid WebSocket URL", {
        url: value,
        operation: "request",
        code: "invalid-url",
        phase: "prepare",
        delivery: "not-sent",
      }),
  })

export const open = (input: WebSocketRequest) =>
  Effect.try({
    try: () =>
      new (globalThis.WebSocket as unknown as WebSocketConstructorWithHeaders)(input.url, { headers: input.headers }),
    catch: (error) =>
      transportError("open", error instanceof Error ? error.message : "Failed to construct WebSocket", {
        url: input.url,
        operation: "request",
        phase: "connect",
        delivery: "not-sent",
      }),
  }).pipe(Effect.flatMap((ws) => fromWebSocket(ws, input)))

export const layer: Layer.Layer<Service> = Layer.succeed(Service, Service.of({ open }))

export const fromWebSocket = (
  ws: globalThis.WebSocket,
  input: WebSocketRequest,
): Effect.Effect<WebSocketConnection, AIError> =>
  Effect.gen(function* () {
    yield* waitOpen(ws, input)
    const messages = yield* Queue.bounded<string | Uint8Array, AIError | Cause.Done<void>>(128)

    const oversized = (message: string | Uint8Array) =>
      typeof message === "string" ? new Blob([message]).size > MAX_FRAME_BYTES : message.byteLength > MAX_FRAME_BYTES
    const rejectOversized = (message: string | Uint8Array) => {
      if (!oversized(message)) return false
      Queue.failCauseUnsafe(
        messages,
        Cause.fail(
          transportError("message", "WebSocket message exceeds the 16 MiB limit", {
            url: input.url,
            operation: "read",
            code: "message-too-large",
            phase: "receive",
          }),
        ),
      )
      if (ws.readyState === globalThis.WebSocket.OPEN) ws.close(1009, "Message too large")
      return true
    }

    const onMessage = (event: MessageEvent) => {
      if (typeof event.data === "string") {
        if (rejectOversized(event.data)) return
        return Queue.offerUnsafe(messages, event.data)
      }
      const binary = binaryMessage(event.data)
      if (binary) {
        if (rejectOversized(binary)) return
        return Queue.offerUnsafe(messages, binary)
      }
      Queue.failCauseUnsafe(
        messages,
        Cause.fail(
          transportError("message", "Unsupported WebSocket message payload", {
            url: input.url,
            operation: "read",
            code: "message",
            phase: "receive",
          }),
        ),
      )
    }
    const onError = (event: Event) => {
      Queue.failCauseUnsafe(
        messages,
        Cause.fail(
          transportError("message", `WebSocket error: ${eventMessage(event)}`, {
            url: input.url,
            operation: "read",
            code: "message",
            phase: "receive",
          }),
        ),
      )
    }
    const onClose = (event: CloseEvent) => {
      Queue.failCauseUnsafe(
        messages,
        Cause.fail(
          transportError("message", `WebSocket closed with code ${event.code}`, {
            url: input.url,
            operation: "read",
            code: String(event.code),
            phase: "close",
          }),
        ),
      )
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
            transportError("sendText", error instanceof Error ? error.message : "Failed to send WebSocket message", {
              url: input.url,
              operation: "write",
              phase: "send",
              delivery: "not-sent",
            }),
        }),
      messages: Stream.fromQueue(messages),
      close: cleanup.pipe(
        Effect.andThen(
          Effect.sync(() => {
            if (ws.readyState === globalThis.WebSocket.CLOSED || ws.readyState === globalThis.WebSocket.CLOSING) return
            ws.close(1000)
          }),
        ),
      ),
    }
  })

export const messageText = (message: string | Uint8Array, decoder: TextDecoder) =>
  typeof message === "string" ? message : decoder.decode(message)

export interface JsonPrepared {
  readonly url: string
  readonly headers: Headers.Headers
  readonly message: string
}

export interface JsonInput<Body, Message> {
  readonly toMessage: (body: Body | Record<string, unknown>) => Effect.Effect<Message, AIError>
  readonly encodeMessage: (message: Message) => string
}

export type JsonPatch<Body, Message> = Partial<JsonInput<Body, Message>>

export interface JsonTransport<Body, Message> extends Transport<Body, JsonPrepared, string> {
  readonly with: (patch: JsonPatch<Body, Message>) => JsonTransport<Body, Message>
}

export const json = <Body, Message>(input: JsonInput<Body, Message>): JsonTransport<Body, Message> => ({
  id: "websocket-json",
  with: (patch) => json({ ...input, ...patch }),
  prepare: (prepareInput) =>
    Effect.gen(function* () {
      const parts = yield* HttpTransport.jsonRequestParts({
        ...prepareInput,
      })
      return {
        url: yield* webSocketUrl(parts.url),
        headers: parts.headers,
        message: input.encodeMessage(yield* input.toMessage(parts.jsonBody)),
      }
    }),
  frames: (prepared, _request, runtime) => {
    const webSocket = runtime.webSocket
    if (!webSocket) {
      return Stream.fail(
        transportError("json", "WebSocket JSON transport requires WebSocketExecutor.Service", {
          url: prepared.url,
          operation: "request",
          code: "unavailable",
          phase: "prepare",
          delivery: "not-sent",
        }),
      )
    }
    const decoder = new TextDecoder()
    return Stream.unwrap(
      Effect.gen(function* () {
        const connection = yield* Effect.acquireRelease(
          webSocket
            .open({ url: prepared.url, headers: prepared.headers })
            .pipe(
              Effect.mapError((error) => annotateTransportError(error, { phase: "connect", delivery: "not-sent" })),
            ),
          (connection) => connection.close,
        )
        yield* connection.sendText(prepared.message)
        let observed = false
        return connection.messages.pipe(
          Stream.map((message) => {
            observed = true
            return messageText(message, decoder)
          }),
          Stream.mapError((error) =>
            annotateTransportError(error, {
              phase: error.reason._tag === "Transport" && error.reason.phase === "close" ? "close" : "receive",
              delivery: observed ? "accepted" : "ambiguous",
            }),
          ),
        )
      }),
    )
  },
})

export const jsonTransport = {
  id: "websocket-json",
  with: json,
} as const

export const WebSocketExecutor = {
  Service,
  layer,
  open,
  fromWebSocket,
  messageText,
} as const

export const WebSocketTransport = {
  json,
  jsonTransport,
} as const
