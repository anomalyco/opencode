import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import { RpcClient, RpcClientError, type RpcMessage } from "effect/unstable/rpc"
import { JsonRpc, SimulationRequestError } from "@opencode-ai/protocol/simulation"

interface PendingRequest {
  readonly clientId: number
  readonly method: string
  readonly requestId: string | number
}

type TransportEvent =
  | { readonly _tag: "Message"; readonly data: string }
  | { readonly _tag: "Close" }
  | { readonly _tag: "Error"; readonly cause: unknown }

export interface Notification {
  readonly method: string
  readonly params: unknown
}

export interface Options {
  readonly connectTimeout?: number
  readonly firstWireId?: number
  readonly onClose?: () => Effect.Effect<void>
  readonly onNotification?: (notification: Notification) => Effect.Effect<void>
}

const decodeResponse = Schema.decodeUnknownOption(JsonRpc.Response)
const encodeRequestError = Schema.encodeSync(Schema.toCodecJson(SimulationRequestError))

export const make = Effect.fn("OpenCodeRpcProtocol.make")(function* (endpoint: string, options?: Options) {
  const connectTimeout = options?.connectTimeout ?? 30_000
  let closing = false
  const socket = yield* Effect.acquireRelease(
    open(endpoint).pipe(
      Effect.timeoutOrElse({
        duration: connectTimeout,
        orElse: () =>
          Effect.fail(
            protocolError(
              `cannot connect to ${endpoint}: timed out after ${connectTimeout}ms`,
              new Error("WebSocket connection timed out"),
            ),
          ),
      }),
    ),
    (socket) =>
      Effect.sync(() => {
        closing = true
        socket.terminate()
      }),
  )

  return yield* RpcClient.Protocol.make((write, clientIds) =>
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<TransportEvent>()
      const pending = new Map<number, PendingRequest>()
      const wireIds = new Map<number, Map<string | number, number>>()
      let nextWireId = options?.firstWireId ?? 1
      let currentError: RpcClientError.RpcClientError | undefined

      const removePending = (wireId: number) => {
        const request = pending.get(wireId)
        if (request === undefined) return undefined
        pending.delete(wireId)
        const clientWireIds = wireIds.get(request.clientId)
        clientWireIds?.delete(request.requestId)
        if (clientWireIds?.size === 0) wireIds.delete(request.clientId)
        return request
      }

      const failAll = (message: string, cause: unknown) =>
        Effect.gen(function* () {
          if (closing || currentError !== undefined) return
          const error = protocolError(message, cause)
          currentError = error
          pending.clear()
          wireIds.clear()
          yield* Effect.forEach(clientIds, (clientId) =>
            write(clientId, {
              _tag: "ClientProtocolError",
              error,
            }),
          )
          if (socket.readyState === WebSocket.OPEN) socket.terminate()
        })

      const handleMessage = (data: string): Effect.Effect<void> => {
        let value: unknown
        try {
          value = JSON.parse(data)
        } catch (cause) {
          return failAll("received invalid JSON", cause)
        }

        if (isRecord(value) && typeof value.method === "string") {
          if (value.jsonrpc !== "2.0" || "id" in value)
            return failAll("received an invalid JSON-RPC notification", value)
          return (
            options?.onNotification?.({
              method: value.method,
              params: "params" in value ? value.params : undefined,
            }) ?? Effect.void
          )
        }

        if (!isRecord(value)) return failAll("received an invalid JSON-RPC response", value)
        const hasResult = Object.hasOwn(value, "result")
        const hasError = Object.hasOwn(value, "error")
        if (hasResult === hasError) return failAll("JSON-RPC response must contain result or error", value)

        const decoded = decodeResponse(value)
        if (Option.isNone(decoded)) return failAll("received an invalid JSON-RPC response", value)
        const response = decoded.value
        if (typeof response.id !== "number") return failAll("received an invalid JSON-RPC response ID", response.id)
        const request = removePending(response.id)
        if (request === undefined) return Effect.void

        if (response.error !== undefined) {
          const error = new SimulationRequestError({
            method: request.method,
            code: response.error.code,
            message: response.error.message,
            ...(response.error.data === undefined ? {} : { data: response.error.data }),
          })
          return write(request.clientId, {
            _tag: "Exit",
            requestId: request.requestId,
            exit: {
              _tag: "Failure",
              cause: [{ _tag: "Fail", error: encodeRequestError(error) }],
            },
          })
        }

        return write(request.clientId, {
          _tag: "Exit",
          requestId: request.requestId,
          exit: { _tag: "Success", value: response.result },
        })
      }

      const handleEvent = (event: TransportEvent) => {
        switch (event._tag) {
          case "Message":
            return handleMessage(event.data)
          case "Close":
            return Effect.andThen(
              options?.onClose?.() ?? Effect.void,
              failAll("connection closed", new Error("connection closed")),
            )
          case "Error":
            return Effect.andThen(options?.onClose?.() ?? Effect.void, failAll("connection error", event.cause))
        }
        return Effect.void
      }

      yield* Queue.take(events).pipe(Effect.flatMap(handleEvent), Effect.forever, Effect.forkScoped)

      const onMessage = (event: MessageEvent) =>
        Queue.offerUnsafe(events, {
          _tag: "Message",
          data: String(event.data),
        })
      const onClose = () => Queue.offerUnsafe(events, { _tag: "Close" })
      const onError = (cause: Event) => Queue.offerUnsafe(events, { _tag: "Error", cause })
      socket.addEventListener("message", onMessage)
      socket.addEventListener("close", onClose)
      socket.addEventListener("error", onError)
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          socket.removeEventListener("message", onMessage)
          socket.removeEventListener("close", onClose)
          socket.removeEventListener("error", onError)
        }).pipe(Effect.andThen(Queue.shutdown(events))),
      )

      const send = (clientId: number, message: RpcMessage.FromClientEncoded) =>
        Effect.suspend(() => {
          if (currentError !== undefined) return Effect.fail(currentError)
          if (message._tag === "Interrupt") {
            const clientWireIds = wireIds.get(clientId)
            const wireId = clientWireIds?.get(message.requestId)
            if (wireId !== undefined) removePending(wireId)
            return Effect.void
          }
          if (message._tag !== "Request") return Effect.void
          if (socket.readyState !== WebSocket.OPEN)
            return Effect.fail(protocolError("connection is not open", new Error("connection is not open")))

          let clientWireIds = wireIds.get(clientId)
          if (clientWireIds === undefined) {
            clientWireIds = new Map()
            wireIds.set(clientId, clientWireIds)
          }
          if (clientWireIds.has(message.id))
            return Effect.fail(protocolError("duplicate RPC request ID", new Error(String(message.id))))

          const wireId = nextWireId++
          const payload = message.tag === "ui.press" ? encodePressPayload(message.payload) : message.payload
          pending.set(wireId, {
            clientId,
            method: message.tag,
            requestId: message.id,
          })
          clientWireIds.set(message.id, wireId)
          return Effect.try({
            try: () => {
              socket.send(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: wireId,
                  method: message.tag,
                  ...(payload === undefined || payload === null ? {} : { params: payload }),
                }),
              )
            },
            catch: (cause) => {
              removePending(wireId)
              return protocolError("failed to send request", cause)
            },
          })
        })

      return {
        send,
        supportsAck: false,
        supportsTransferables: false,
      }
    }),
  )
})

const arrows = {
  up: { final: "A", kitty: 57_352 },
  down: { final: "B", kitty: 57_353 },
  right: { final: "C", kitty: 57_351 },
  left: { final: "D", kitty: 57_350 },
} as const

function encodePressPayload(payload: unknown) {
  if (typeof payload !== "object" || payload === null) return payload
  const key = Reflect.get(payload, "key")
  if (typeof key !== "string") return payload
  const modifiers = Reflect.get(payload, "modifiers")
  const modifier = modifierMask(modifiers)
  const named = key.toLowerCase()
  const arrowName = named.startsWith("arrow_") ? named.slice(6) : named
  const arrow =
    arrowName === "up"
      ? arrows.up
      : arrowName === "down"
        ? arrows.down
        : arrowName === "right"
          ? arrows.right
          : arrowName === "left"
            ? arrows.left
            : undefined
  if (arrow !== undefined) {
    if (modifier & 24) return { key: kittySequence(arrow.kitty, modifier) }
    return {
      key: modifier === 0 ? `\u001b[${arrow.final}` : `\u001b[1;${modifier + 1}${arrow.final}`,
    }
  }
  if (named === "tab" && modifier !== 0) return { key: kittySequence(9, modifier) }
  return payload
}

function modifierMask(value: unknown) {
  if (typeof value !== "object" || value === null) return 0
  return (
    (Reflect.get(value, "shift") === true ? 1 : 0) |
    (Reflect.get(value, "meta") === true ? 2 : 0) |
    (Reflect.get(value, "ctrl") === true ? 4 : 0) |
    (Reflect.get(value, "super") === true ? 8 : 0) |
    (Reflect.get(value, "hyper") === true ? 16 : 0)
  )
}

function kittySequence(codepoint: number, modifier: number) {
  return `\u001b[${codepoint};${modifier + 1}u`
}

function open(endpoint: string) {
  return Effect.callback<WebSocket, RpcClientError.RpcClientError>((resume) => {
    let socket: WebSocket
    try {
      socket = new WebSocket(endpoint)
    } catch (cause) {
      resume(Effect.fail(protocolError(`cannot connect to ${endpoint}`, cause)))
      return Effect.void
    }
    let settled = false
    const complete = (effect: Effect.Effect<WebSocket, RpcClientError.RpcClientError>) => {
      if (settled) return
      settled = true
      cleanup()
      resume(effect)
    }
    const onOpen = () => complete(Effect.succeed(socket))
    const onError = (cause: Event) => {
      complete(Effect.fail(protocolError(`cannot connect to ${endpoint}`, cause)))
      socket.terminate()
    }
    const onClose = () => {
      complete(
        Effect.fail(protocolError(`cannot connect to ${endpoint}`, new Error("connection closed before opening"))),
      )
    }
    const cleanup = () => {
      socket.removeEventListener("open", onOpen)
      socket.removeEventListener("error", onError)
      socket.removeEventListener("close", onClose)
    }
    socket.addEventListener("open", onOpen)
    socket.addEventListener("error", onError)
    socket.addEventListener("close", onClose)
    return Effect.sync(() => {
      cleanup()
      socket.terminate()
    })
  })
}

function protocolError(message: string, cause: unknown) {
  return new RpcClientError.RpcClientError({
    reason: new RpcClientError.RpcClientDefect({ message, cause }),
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
