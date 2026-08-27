import { Cause, Effect, Queue, Stream } from "effect"
import { Headers } from "effect/unstable/http"
import { Socket } from "effect/unstable/socket"
import { AIError, TransportReason, type TransportOperation } from "../../schema/index.js"
import { classifyHttpFailure } from "../executor.js"
import * as HttpTransport from "./http.js"
import type { Transport } from "./index.js"
import type {
  ChannelObservation,
  WebSocketChannelDriver,
  WebSocketChannelExchange,
  WebSocketChannelExecutor,
} from "./websocket-channel.js"

export interface WebSocketRequest {
  readonly url: string
  readonly headers: Headers.Headers
}

export interface WebSocketConnection {
  readonly sendText: (message: string) => Effect.Effect<void, AIError>
  readonly messages: Stream.Stream<string | Uint8Array, AIError>
  readonly close: Effect.Effect<void, never>
}

export interface WebSocketConnector {
  readonly open: (input: WebSocketRequest) => Effect.Effect<WebSocketConnection, AIError>
}

type WebSocketConstructorWithHeaders = (
  url: string,
  options?: { readonly headers?: Headers.Headers },
) => globalThis.WebSocket

interface UpgradeResponse extends AsyncIterable<unknown> {
  readonly statusCode?: number
  readonly headers: Readonly<Record<string, string | ReadonlyArray<string> | undefined>>
}

type UpgradeListener = (request: unknown, response: UpgradeResponse) => void

interface UpgradeAwareWebSocket extends globalThis.WebSocket {
  readonly once?: (event: "unexpected-response", listener: UpgradeListener) => void
  readonly off?: (event: "unexpected-response", listener: UpgradeListener) => void
}

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
    module: "WebSocketConnector",
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

const upgradeHeaders = (headers: UpgradeResponse["headers"]) =>
  Object.fromEntries(
    Object.entries(headers).flatMap(([name, value]) => {
      if (value === undefined) return []
      return [[name, Array.isArray(value) ? value.join(", ") : String(value)]]
    }),
  )

const upgradeBody = (input: WebSocketRequest, response: UpgradeResponse) =>
  Stream.fromAsyncIterable(response, (error) =>
    transportError("open", error instanceof Error ? error.message : "Failed to read WebSocket upgrade response", {
      url: input.url,
      operation: "read",
      phase: "connect",
      delivery: "not-sent",
    }),
  ).pipe(
    Stream.mapEffect((chunk) => {
      if (typeof chunk === "string") return Effect.succeed(new TextEncoder().encode(chunk))
      const binary = binaryMessage(chunk)
      if (binary) return Effect.succeed(binary)
      return Effect.fail(
        transportError("open", "Unsupported WebSocket upgrade response body", {
          url: input.url,
          operation: "read",
          phase: "connect",
          delivery: "not-sent",
        }),
      )
    }),
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (body, chunk) => body + chunk,
    ),
  )

const rejectedUpgrade = (input: WebSocketRequest, response: UpgradeResponse, body: string | undefined) =>
  new AIError({
    module: "WebSocketConnector",
    method: "open",
    reason: classifyHttpFailure({
      message: `WebSocket upgrade rejected with HTTP ${response.statusCode ?? "unknown"}`,
      method: "GET",
      url: input.url,
      requestHeaders: { ...input.headers },
      status: response.statusCode,
      code: "UnexpectedServerResponse",
      responseHeaders: upgradeHeaders(response.headers),
      responseBody: body,
    }),
  })

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
    const upgrade: UpgradeAwareWebSocket = ws
    const unexpectedResponse = upgrade.once && upgrade.off ? upgrade : undefined
    const cleanup = () => {
      ws.removeEventListener("open", onOpen)
      ws.removeEventListener("error", onError)
      ws.removeEventListener("close", onClose)
      unexpectedResponse?.off?.("unexpected-response", onUnexpectedResponse)
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
    const onUnexpectedResponse: UpgradeListener = (_request, response) => {
      cleanup()
      resume(
        upgradeBody(input, response).pipe(
          Effect.catch(() => Effect.succeed(undefined)),
          Effect.flatMap((body) => Effect.fail(rejectedUpgrade(input, response, body))),
          Effect.ensuring(
            Effect.sync(() => {
              ws.addEventListener("error", () => {}, { once: true })
              if (ws.readyState === globalThis.WebSocket.CONNECTING) ws.close()
            }),
          ),
        ),
      )
    }
    ws.addEventListener("open", onOpen, { once: true })
    ws.addEventListener("error", onError, { once: true })
    ws.addEventListener("close", onClose, { once: true })
    unexpectedResponse?.once?.("unexpected-response", onUnexpectedResponse)
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

export const toWebSocketUrl = (value: string) =>
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
  Effect.gen(function* () {
    const constructor = yield* Socket.WebSocketConstructor
    const ws = yield* Effect.try({
      try: () =>
        // Platform implementations may extend Effect's browser-compatible constructor with handshake options.
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        (constructor as unknown as WebSocketConstructorWithHeaders)(input.url, {
          headers: input.headers,
        }),
      catch: (error) =>
        transportError("open", error instanceof Error ? error.message : "Failed to construct WebSocket", {
          url: input.url,
          operation: "request",
          phase: "connect",
          delivery: "not-sent",
        }),
    })
    return yield* fromWebSocket(ws, input)
  })

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
    const offer = (message: string | Uint8Array) => {
      if (rejectOversized(message)) return
      if (Queue.offerUnsafe(messages, message)) return
      Queue.failCauseUnsafe(
        messages,
        Cause.fail(
          transportError("message", "WebSocket inbound queue overflow", {
            url: input.url,
            operation: "read",
            code: "queue-overflow",
            phase: "receive",
          }),
        ),
      )
    }

    const onMessage = (event: MessageEvent) => {
      if (typeof event.data === "string") return offer(event.data)
      const binary = binaryMessage(event.data)
      if (binary) return offer(binary)
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
        Effect.suspend(() => {
          if (ws.readyState !== globalThis.WebSocket.OPEN)
            return Effect.fail(
              transportError("sendText", `WebSocket is not open (state ${ws.readyState})`, {
                url: input.url,
                operation: "write",
                phase: "send",
                delivery: "not-sent",
              }),
            )
          return Effect.try({
            try: () => ws.send(message),
            catch: (error) =>
              transportError("sendText", error instanceof Error ? error.message : "Failed to send WebSocket message", {
                url: input.url,
                operation: "write",
                phase: "send",
                delivery: "not-sent",
              }),
          })
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

const observationFrame = (observation: ChannelObservation) => {
  if (observation.type === "frame" || observation.type === "completed" || observation.type === "incomplete")
    return Effect.succeed(observation.frame)
  return Effect.fail(observation.error)
}

const observationTerminal = (observation: ChannelObservation) => observation.type !== "frame"

export const makeDirect = (connector: WebSocketConnector): WebSocketChannelExecutor => ({
  execute: (exchange) =>
    Effect.gen(function* () {
      const connection = yield* Effect.acquireRelease(
        connector
          .open(exchange.connect)
          .pipe(Effect.mapError((error) => annotateTransportError(error, { phase: "connect", delivery: "not-sent" }))),
        (connection) => connection.close,
      )
      const create = yield* exchange.driver.create(undefined)
      yield* connection.sendText(create.message)
      const decoder = new TextDecoder()
      let observed = false
      return {
        frames: connection.messages.pipe(
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
          Stream.mapEffect((frame) => exchange.driver.observe(create, frame)),
          Stream.takeUntil(observationTerminal),
          Stream.mapEffect(observationFrame),
        ),
        complete: Effect.void,
      }
    }),
})

export const direct: Effect.Effect<WebSocketChannelExecutor, never, Socket.WebSocketConstructor> = Effect.gen(
  function* () {
    const constructor = yield* Socket.WebSocketConstructor
    return makeDirect({
      open: (input) => open(input).pipe(Effect.provideService(Socket.WebSocketConstructor, constructor)),
    })
  },
)

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
        url: yield* toWebSocketUrl(parts.url),
        headers: parts.headers,
        message: input.encodeMessage(yield* input.toMessage(parts.jsonBody)),
      }
    }),
  execute: (prepared, request, _runtime, options) => {
    const webSocket = options?.webSocket
    if (!webSocket) {
      return Effect.fail(
        transportError("json", "WebSocket JSON transport requires StreamOptions.webSocket", {
          url: prepared.url,
          operation: "request",
          code: "unavailable",
          phase: "prepare",
          delivery: "not-sent",
        }),
      )
    }
    const driver: WebSocketChannelDriver = {
      create: () => Effect.succeed({ message: prepared.message, mode: "full" }),
      observe: (_create, frame) => Effect.succeed({ type: "frame", frame }),
    }
    const exchange: WebSocketChannelExchange = {
      id: request.id ?? "request",
      connect: { url: prepared.url, headers: prepared.headers },
      fallback: () =>
        Stream.fail(
          transportError("fallback", "WebSocket JSON transport does not provide HTTP fallback", {
            url: prepared.url,
            operation: "request",
            code: "websocket",
            phase: "fallback",
            delivery: "not-sent",
          }),
        ),
      driver,
    }
    return webSocket.execute(exchange)
  },
})

export const jsonTransport = {
  id: "websocket-json",
  with: json,
} as const

export const WebSocketTransport = {
  json,
  jsonTransport,
  direct,
  makeDirect,
  open,
  fromWebSocket,
  messageText,
  toWebSocketUrl,
} as const
