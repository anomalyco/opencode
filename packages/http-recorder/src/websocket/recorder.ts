import { NodeFileSystem } from "@effect/platform-node-shared"
import { Deferred, Effect, Exit, FiberSet, Layer, Option, Ref, Scope, Semaphore } from "effect"
import { Socket } from "effect/unstable/socket"
import { fileSystem, type Interface, Service } from "../cassette/store.js"
import type { SocketRecorderOptions } from "../options.js"
import { make, type Redactor } from "../redaction/redactor.js"
import { canonicalizeJson, decodeJson, safeText } from "../replay/comparison.js"
import { makeReplayState, resolveAutoMode } from "../replay/state.js"
import { webSocketInteractions, type Interaction } from "../cassette/model.js"
import type { WebSocketEvent, WebSocketInteraction } from "./model.js"

interface WebSocketRecorderOptions extends SocketRecorderOptions {
  readonly compareClientMessagesAsJson?: boolean
}
interface ActiveReplay {
  readonly interaction: WebSocketInteraction
  readonly progress: Ref.Ref<{ readonly position: number; readonly changed: Deferred.Deferred<void> }>
  readonly writeLock: Semaphore.Semaphore
  readonly closed: Ref.Ref<boolean>
}
interface ActiveRecording {
  readonly events: Array<WebSocketEvent>
  readonly eventLock: Semaphore.Semaphore
  readonly accepting: Ref.Ref<boolean>
  opened: boolean
  valid: boolean
}
interface PendingRecordings {
  readonly promises: Set<Promise<void>>
  readonly errors: Array<unknown>
}
type Frame = string | Uint8Array

const normalizeProtocols = (protocols?: string | Array<string>): Array<string> =>
  protocols === undefined ? [] : typeof protocols === "string" ? [protocols] : [...protocols]
const frameFromWebSocketData = async (data: unknown): Promise<Frame> => {
  if (typeof data === "string") return data
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer())
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()
  throw new Error(`Unsupported WebSocket frame: ${Object.prototype.toString.call(data)}`)
}
const closeEvent = (code: number, reason: string): CloseEvent => {
  if (typeof globalThis.CloseEvent === "function")
    return new globalThis.CloseEvent("close", { code, reason, wasClean: code === 1000 })
  const event = new Event("close")
  Object.defineProperties(event, {
    code: { value: code },
    reason: { value: reason },
    wasClean: { value: code === 1000 },
  })
  return event as CloseEvent
}
const errorEvent = (error: unknown): ErrorEvent => {
  if (typeof globalThis.ErrorEvent === "function")
    return new globalThis.ErrorEvent("error", {
      error,
      message: error instanceof Error ? error.message : String(error),
    })
  const event = new Event("error")
  Object.defineProperties(event, {
    error: { value: error },
    message: { value: error instanceof Error ? error.message : String(error) },
  })
  return event as ErrorEvent
}
const webSocketFacade = (
  target: EventTarget,
  properties: {
    readonly url: () => string
    readonly readyState: () => number
    readonly protocol: () => string
    readonly extensions: () => string
    readonly bufferedAmount: () => number
    readonly send: (data: string | ArrayBufferLike | Blob | ArrayBufferView) => void
    readonly close: (code?: number, reason?: string) => void
  },
): globalThis.WebSocket => {
  Object.defineProperties(target, {
    url: { get: properties.url },
    readyState: { get: properties.readyState },
    protocol: { get: properties.protocol },
    extensions: { get: properties.extensions },
    bufferedAmount: { get: properties.bufferedAmount },
    binaryType: { value: "blob", writable: true },
    send: { value: properties.send },
    close: { value: properties.close },
    CONNECTING: { value: 0 },
    OPEN: { value: 1 },
    CLOSING: { value: 2 },
    CLOSED: { value: 3 },
  })
  for (const name of ["open", "message", "error", "close"] as const) {
    let handler: ((event: Event) => unknown) | null = null
    Object.defineProperty(target, `on${name}`, {
      get: () => handler,
      set: (next) => {
        if (handler) target.removeEventListener(name, handler)
        handler = typeof next === "function" ? next : null
        if (handler) target.addEventListener(name, handler)
      },
    })
  }
  return target as globalThis.WebSocket
}

const encodeEvent = (direction: "client" | "server", message: Frame): WebSocketEvent =>
  typeof message === "string"
    ? { direction, kind: "text", body: message }
    : { direction, kind: "binary", body: Buffer.from(message).toString("base64"), bodyEncoding: "base64" }
const decodeEvent = (event: WebSocketEvent): Frame =>
  event.kind === "text" ? event.body : new Uint8Array(Buffer.from(event.body, "base64"))
const redactEvent = (event: WebSocketEvent, redactor: Redactor): WebSocketEvent => {
  if (event.kind === "binary") return event
  const body =
    event.direction === "client"
      ? redactor.request({ method: "WEBSOCKET", url: "", headers: {}, body: event.body }).body
      : redactor.response({ status: 101, headers: {}, body: event.body }).body
  return { ...event, body }
}
const comparable = (event: WebSocketEvent, asJson: boolean) => {
  if (!asJson || event.kind === "binary") return JSON.stringify(canonicalizeJson(event))
  const decoded = decodeJson(event.body)
  return JSON.stringify(
    canonicalizeJson({ ...event, body: decoded._tag === "None" ? event.body : canonicalizeJson(decoded.value) }),
  )
}
const assertEvent = (actual: WebSocketEvent, expected: WebSocketEvent | undefined, index: number, asJson: boolean) =>
  Effect.sync(() => {
    if (expected && comparable(actual, asJson) === comparable(expected, asJson)) return
    throw new Error(`WebSocket event ${index + 1}: expected ${safeText(expected)}, received ${safeText(actual)}`)
  })
const runHandler = <A, E, R>(handler: (value: A) => Effect.Effect<unknown, E, R> | void, value: A) =>
  Effect.suspend(() => {
    const result = handler(value)
    return Effect.isEffect(result) ? Effect.asVoid(result) : Effect.void
  })
const runReplay = <A, E, R>(
  state: ActiveReplay,
  handler: (value: A) => Effect.Effect<unknown, E, R> | void,
  decode: (event: WebSocketEvent) => A,
  onOpen: Effect.Effect<void> | undefined,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const handlers = yield* FiberSet.make<unknown, E>()
      const run = yield* FiberSet.runtime(handlers)<R>()
      if (onOpen) yield* onOpen
      const drive = Effect.gen(function* () {
        while (true) {
          const current = yield* Ref.get(state.progress)
          const event = state.interaction.events[current.position]
          if (!event) return
          if (yield* Ref.get(state.closed))
            return yield* Effect.die(
              new Error(
                `WebSocket closed with unconsumed events: used ${current.position} of ${state.interaction.events.length}`,
              ),
            )
          if (event.direction === "server") {
            yield* Ref.set(state.progress, { position: current.position + 1, changed: yield* Deferred.make<void>() })
            run(runHandler(handler, decode(event)))
            continue
          }
          yield* Deferred.await(current.changed)
        }
      })
      yield* drive.pipe(Effect.raceFirst(FiberSet.join(handlers)))
      yield* FiberSet.awaitEmpty(handlers).pipe(Effect.raceFirst(FiberSet.join(handlers)))
    }),
  )

const makeRecordingSocket = (
  upstream: Socket.Socket,
  cassette: Interface,
  name: string,
  options: WebSocketRecorderOptions,
  redactor: Redactor,
) =>
  Effect.gen(function* () {
    const active = yield* Ref.make<ActiveRecording | undefined>(undefined)
    const writeLock = yield* Semaphore.make(1)
    return Socket.make({
      runRaw: (handler, runOptions) =>
        Effect.gen(function* () {
          const state: ActiveRecording = {
            events: [],
            eventLock: yield* Semaphore.make(1),
            accepting: yield* Ref.make(true),
            opened: false,
            valid: true,
          }
          const occupied = yield* Ref.modify(active, (current) => [current !== undefined, current ?? state])
          if (occupied) return yield* Effect.die("Concurrent runs of a recorded WebSocket are not supported")
          yield* upstream
            .runRaw(
              (message) => {
                if (!Ref.getUnsafe(state.accepting)) throw new Error("WebSocket received a frame after closing")
                state.events.push(redactEvent(encodeEvent("server", message), redactor))
                return handler(message)
              },
              {
                ...runOptions,
                onOpen: Effect.gen(function* () {
                  state.opened = true
                  if (runOptions?.onOpen) yield* runOptions.onOpen
                }),
              },
            )
            .pipe(
              Effect.onExit((exit) =>
                writeLock.withPermit(
                  state.eventLock.withPermit(
                    Effect.gen(function* () {
                      yield* Ref.set(state.accepting, false)
                      yield* Ref.set(active, undefined)
                      if (!Exit.isSuccess(exit) || !state.opened || !state.valid) return
                      yield* cassette
                        .append(
                          name,
                          {
                            transport: "websocket",
                            events: [...state.events],
                          },
                          options.metadata,
                        )
                        .pipe(Effect.orDie)
                    }),
                  ),
                ),
              ),
            )
        }),
      writer: upstream.writer.pipe(
        Effect.map(
          (write) => (message) =>
            writeLock.withPermit(
              Effect.gen(function* () {
                if (Socket.isCloseEvent(message)) return yield* write(message)
                const state = yield* Ref.get(active)
                if (!state || !(yield* Ref.get(state.accepting)))
                  return yield* Effect.die("WebSocket writer used without an active socket run")
                const event = redactEvent(encodeEvent("client", message), redactor)
                yield* state.eventLock.withPermit(Effect.sync(() => state.events.push(event)))
                return yield* write(message).pipe(Effect.onError(() => Effect.sync(() => (state.valid = false))))
              }),
            ),
        ),
      ),
    })
  })

const makeReplaySocket = (
  cassette: Interface,
  name: string,
  options: WebSocketRecorderOptions,
  redactor: Redactor,
): Effect.Effect<Socket.Socket, never, Scope.Scope> =>
  Effect.gen(function* () {
    const replay = yield* makeReplayState(cassette, name, webSocketInteractions)
    const active = yield* Ref.make<ActiveReplay | undefined>(undefined)
    const runLock = yield* Semaphore.make(1)
    return Socket.make({
      runRaw: (handler, runOptions) =>
        runLock
          .withPermitsIfAvailable(1)(
            Effect.gen(function* () {
              const claimed = yield* replay
                .claim((interaction) =>
                  interaction ? Effect.void : Effect.die("Missing recorded WebSocket interaction"),
                )
                .pipe(Effect.orDie)
              const state = {
                interaction: claimed.interaction,
                progress: yield* Ref.make({ position: 0, changed: yield* Deferred.make<void>() }),
                writeLock: yield* Semaphore.make(1),
                closed: yield* Ref.make(false),
              }
              yield* Ref.set(active, state)
              yield* runReplay(state, handler, decodeEvent, runOptions?.onOpen).pipe(
                Effect.ensuring(Ref.set(active, undefined)),
              )
            }),
          )
          .pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.die("Concurrent runs of a replayed WebSocket are not supported"),
                onSome: () => Effect.void,
              }),
            ),
          ),
      writer: Effect.succeed((message) =>
        Ref.get(active).pipe(
          Effect.flatMap((state) =>
            state
              ? state.writeLock.withPermit(
                  Effect.gen(function* () {
                    const current = yield* Ref.get(state.progress)
                    if (Socket.isCloseEvent(message)) {
                      yield* Ref.set(state.closed, true)
                      yield* Deferred.succeed(current.changed, undefined)
                      if (current.position === state.interaction.events.length) return
                      return yield* Effect.die(
                        new Error(
                          `WebSocket closed with unconsumed events: used ${current.position} of ${state.interaction.events.length}`,
                        ),
                      )
                    }
                    const actual = redactEvent(encodeEvent("client", message), redactor)
                    yield* assertEvent(
                      actual,
                      state.interaction.events[current.position],
                      current.position,
                      options.compareClientMessagesAsJson === true,
                    )
                    yield* Ref.set(state.progress, {
                      position: current.position + 1,
                      changed: yield* Deferred.make<void>(),
                    })
                    yield* Deferred.succeed(current.changed, undefined)
                  }),
                )
              : Effect.die("WebSocket writer used without an active socket run"),
          ),
        ),
      ),
    })
  })

const recordingLayer = (
  name: string,
  options: WebSocketRecorderOptions,
  forcedMode?: "record" | "replay",
): Layer.Layer<Socket.Socket, never, Socket.Socket | Service> =>
  Layer.effect(
    Socket.Socket,
    Effect.gen(function* () {
      const upstream = yield* Socket.Socket
      const cassette = yield* Service
      const redactor = make(options.redact)
      if ((forcedMode ?? (yield* resolveAutoMode(cassette, name))) === "record")
        return yield* makeRecordingSocket(upstream, cassette, name, options, redactor)
      return yield* makeReplaySocket(cassette, name, options, redactor)
    }),
  )

export const layerSocket = (
  name: string,
  options: SocketRecorderOptions = {},
): Layer.Layer<Socket.Socket, never, Socket.Socket> =>
  provideCassette(recordingLayer(name, { ...options, compareClientMessagesAsJson: true }), options)
/** @internal */
export const layerSocketWithMode = (
  name: string,
  options: WebSocketRecorderOptions & { readonly mode: "record" | "replay" },
): Layer.Layer<Socket.Socket, never, Socket.Socket> =>
  provideCassette(recordingLayer(name, options, options.mode), options)
const provideCassette = <A, E, R>(layer: Layer.Layer<A, E, R>, options: WebSocketRecorderOptions) =>
  layer.pipe(Layer.provide(fileSystem({ directory: options.directory })), Layer.provide(NodeFileSystem.layer))

const makeRecordingWebSocketConstructor = (
  upstream: Socket.WebSocketConstructor["Service"],
  cassette: Interface,
  name: string,
  metadata: SocketRecorderOptions["metadata"],
  redactor: Redactor,
  pending: PendingRecordings,
): Socket.WebSocketConstructor["Service"] => {
  let nextSequence = 0
  return (url, protocols) => {
    const sequence = nextSequence++
    const requestedProtocols = normalizeProtocols(protocols)
    const native = upstream(url, requestedProtocols)
    const events: WebSocketEvent[] = []
    let opened = false
    let failed = false
    let closed = false
    let queue = Promise.resolve()
    const appendEvent = (direction: "client" | "server", data: unknown) => {
      queue = queue.then(async () => {
        if (failed || closed) return
        try {
          events.push(redactEvent(encodeEvent(direction, await frameFromWebSocketData(data)), redactor))
        } catch {
          failed = true
        }
      })
    }
    const onOpen = () => {
      opened = true
    }
    const onMessage = (event: MessageEvent) => {
      appendEvent("server", event.data)
    }
    const onError = () => {
      failed = true
    }
    const onClose = (event: CloseEvent) => {
      native.removeEventListener("open", onOpen)
      native.removeEventListener("message", onMessage)
      native.removeEventListener("error", onError)
      native.removeEventListener("close", onClose)
      const completion = queue.then(async () => {
        closed = true
        if (opened && !failed) {
          const request = redactor.request({ method: "WEBSOCKET", url, headers: {}, body: "" })
          const interaction: WebSocketInteraction = {
            transport: "websocket",
            connection: {
              sequence,
              url: request.url,
              protocols: requestedProtocols,
              close: { code: event.code, reason: event.reason },
            },
            events: [...events],
          }
          events.length = 0
          await Effect.runPromise(cassette.append(name, interaction, metadata).pipe(Effect.orDie))
        }
      })
      pending.promises.add(completion)
      void completion.then(
        () => pending.promises.delete(completion),
        (error) => {
          pending.promises.delete(completion)
          pending.errors.push(error)
        },
      )
    }
    native.addEventListener("open", onOpen)
    native.addEventListener("message", onMessage)
    native.addEventListener("error", onError)
    native.addEventListener("close", onClose)
    return new Proxy(native, {
      get: (target, property) => {
        if (property === "send")
          return (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
            Reflect.apply(target.send, target, [data])
            appendEvent("client", data)
          }
        const value: unknown = Reflect.get(target, property, target)
        return typeof value === "function" ? value.bind(target) : value
      },
      set: (target, property, value) => Reflect.set(target, property, value, target),
    })
  }
}

const constructorWebSocketInteractions = (interactions: ReadonlyArray<Interaction>) =>
  webSocketInteractions(interactions)
    .filter((interaction) => interaction.connection !== undefined)
    .map((interaction, index) => ({ interaction, index }))
    .toSorted((a, b) => a.interaction.connection!.sequence - b.interaction.connection!.sequence)
    .map(({ interaction }) => interaction)

const makeReplayWebSocketConstructor = (
  cassette: Interface,
  name: string,
  redactor: Redactor,
): Effect.Effect<Socket.WebSocketConstructor["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const replay = yield* makeReplayState(cassette, name, constructorWebSocketInteractions)
    return (url, protocols) => {
      const target = new EventTarget()
      const requestedProtocols = normalizeProtocols(protocols)
      const request = redactor.request({ method: "WEBSOCKET", url, headers: {}, body: "" })
      let readyState = 0
      let interaction: WebSocketInteraction | undefined
      let position = 0
      let finished = false
      let closeRequested = false
      let operations = Promise.resolve()
      const fail = (error: unknown) => {
        if (finished) return
        finished = true
        readyState = 3
        target.dispatchEvent(errorEvent(error))
      }
      const finish = () => {
        if (finished || !interaction || position !== interaction.events.length) return
        finished = true
        readyState = 3
        const terminal = interaction.connection?.close ?? { code: 1000, reason: "" }
        target.dispatchEvent(closeEvent(terminal.code, terminal.reason))
      }
      const drive = () => {
        if (!interaction || finished) return
        while (interaction.events[position]?.direction === "server") {
          const event = interaction.events[position++]
          if (!event) break
          target.dispatchEvent(new MessageEvent("message", { data: decodeEvent(event) }))
        }
        if (position === interaction.events.length) setTimeout(finish, 0)
      }
      Effect.runPromise(
        replay
          .claim((recorded, index) =>
            Effect.sync(() => {
              if (!recorded) throw new Error(`Missing recorded WebSocket connection ${index + 1}`)
              const connection = recorded.connection
              if (!connection) throw new Error(`WebSocket interaction ${index + 1} has no connection metadata`)
              if (connection.url !== request.url)
                throw new Error(
                  `WebSocket connection ${index + 1}: expected URL ${safeText(connection.url)}, received ${safeText(request.url)}`,
                )
              if (
                connection.protocols.length !== requestedProtocols.length ||
                connection.protocols.some((protocol, protocolIndex) => protocol !== requestedProtocols[protocolIndex])
              )
                throw new Error(
                  `WebSocket connection ${index + 1}: expected protocols ${safeText(connection.protocols)}, received ${safeText(requestedProtocols)}`,
                )
            }),
          )
          .pipe(Effect.orDie),
      ).then((claimed) => {
        if (closeRequested) return fail(new Error("WebSocket closed before it opened"))
        interaction = claimed.interaction
        readyState = 1
        target.dispatchEvent(new Event("open"))
        drive()
      }, fail)
      return webSocketFacade(target, {
        url: () => url,
        readyState: () => readyState,
        protocol: () => requestedProtocols[0] ?? "",
        extensions: () => "",
        bufferedAmount: () => 0,
        send: (data) => {
          if (!interaction || readyState !== 1 || closeRequested) throw new Error("WebSocket is not open")
          operations = operations.then(async () => {
            try {
              const frame = await frameFromWebSocketData(data)
              const actual = redactEvent(encodeEvent("client", frame), redactor)
              Effect.runSync(assertEvent(actual, interaction?.events[position], position, true))
              position += 1
              drive()
            } catch (error) {
              fail(error)
            }
          })
        },
        close: () => {
          if (closeRequested || readyState === 3) return
          closeRequested = true
          readyState = 2
          operations = operations.then(() => {
            if (!interaction) return
            if (position !== interaction.events.length)
              return fail(
                new Error(`WebSocket closed with unconsumed events: used ${position} of ${interaction.events.length}`),
              )
            finish()
          })
        },
      })
    }
  })

export const layerWebSocketConstructor = (
  name: string,
  options: SocketRecorderOptions = {},
): Layer.Layer<Socket.WebSocketConstructor, never, Socket.WebSocketConstructor> =>
  provideCassette(
    Layer.effect(
      Socket.WebSocketConstructor,
      Effect.gen(function* () {
        const upstream = yield* Socket.WebSocketConstructor
        const cassette = yield* Service
        const redactor = make(options.redact)
        if ((yield* resolveAutoMode(cassette, name)) === "replay")
          return yield* makeReplayWebSocketConstructor(cassette, name, redactor)
        const pending: PendingRecordings = { promises: new Set(), errors: [] }
        yield* Effect.addFinalizer(() =>
          Effect.promise(() => Promise.all(pending.promises)).pipe(
            Effect.flatMap(() => (pending.errors.length === 0 ? Effect.void : Effect.die(pending.errors[0]))),
          ),
        )
        return makeRecordingWebSocketConstructor(upstream, cassette, name, options.metadata, redactor, pending)
      }),
    ),
    options,
  )
