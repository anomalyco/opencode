import { NodeFileSystem } from "@effect/platform-node"
import { Deferred, Effect, Exit, FiberSet, Layer, Ref, Scope, Semaphore } from "effect"
import { Socket } from "effect/unstable/socket"
import * as CassetteService from "./cassette.js"
import { canonicalizeJson, decodeJson, safeText } from "./matching.js"
import { makeReplayState, resolveAutoMode } from "./recorder.js"
import { make, type Redactor } from "./redactor.js"
import { webSocketInteractions } from "./schema.js"
import type {
  RecorderOptions,
  WebSocketEvent,
  WebSocketInteraction,
  WebSocketRecorderOptions,
  WebSocketRequest,
} from "./types.js"

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

type Frame = string | Uint8Array

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
    canonicalizeJson({
      ...event,
      body: decoded._tag === "None" ? event.body : canonicalizeJson(decoded.value),
    }),
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
            yield* Ref.set(state.progress, {
              position: current.position + 1,
              changed: yield* Deferred.make<void>(),
            })
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

const openSnapshot = (request: WebSocketRequest, redactor: Redactor) => {
  const snapshot = redactor.request({ method: "GET", url: request.url, headers: request.headers ?? {}, body: "" })
  return { url: snapshot.url, headers: snapshot.headers }
}

const makeRecordingSocket = (
  upstream: Socket.Socket,
  cassette: CassetteService.Interface,
  name: string,
  request: WebSocketRequest,
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
                            open: openSnapshot(request, redactor),
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
  cassette: CassetteService.Interface,
  name: string,
  request: WebSocketRequest,
  options: WebSocketRecorderOptions,
  redactor: Redactor,
): Effect.Effect<Socket.Socket, never, Scope.Scope> =>
  Effect.gen(function* () {
    const replay = yield* makeReplayState(cassette, name, webSocketInteractions)
    const active = yield* Ref.make<ActiveReplay | undefined>(undefined)

    return Socket.make({
      runRaw: (handler, runOptions) =>
        Effect.gen(function* () {
          const claimed = yield* replay
            .claim((interaction, index) =>
              Effect.sync(() => {
                const incoming = openSnapshot(request, redactor)
                if (
                  interaction &&
                  JSON.stringify(canonicalizeJson(incoming)) === JSON.stringify(canonicalizeJson(interaction.open))
                )
                  return
                throw new Error(
                  `WebSocket open ${index + 1}: expected ${safeText(interaction?.open)}, received ${safeText(incoming)}`,
                )
              }),
            )
            .pipe(Effect.orDie)
          const progress = yield* Ref.make({ position: 0, changed: yield* Deferred.make<void>() })
          const writeLock = yield* Semaphore.make(1)
          const state = {
            interaction: claimed.interaction,
            progress,
            writeLock,
            closed: yield* Ref.make(false),
          }
          const occupied = yield* Ref.modify(active, (current) => [current !== undefined, current ?? state])
          if (occupied) return yield* Effect.die("Concurrent runs of a replayed WebSocket are not supported")
          yield* runReplay(state, handler, decodeEvent, runOptions?.onOpen).pipe(
            Effect.ensuring(Ref.set(active, undefined)),
          )
        }),
      writer: Effect.succeed((message) => {
        return Ref.get(active).pipe(
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
        )
      }),
    })
  })

const recordingLayer = (
  name: string,
  request: WebSocketRequest,
  options: WebSocketRecorderOptions,
  forcedMode?: "record" | "replay",
): Layer.Layer<Socket.Socket, never, Socket.Socket | CassetteService.Service> =>
  Layer.effect(
    Socket.Socket,
    Effect.gen(function* () {
      const upstream = yield* Socket.Socket
      const cassette = yield* CassetteService.Service
      const redactor = make(options.redact)
      if ((forcedMode ?? (yield* resolveAutoMode(cassette, name))) === "record")
        return yield* makeRecordingSocket(upstream, cassette, name, request, options, redactor)
      return yield* makeReplaySocket(cassette, name, request, options, redactor)
    }),
  )

/**
 * Wraps a provided `Socket.Socket` with cassette recording and replay.
 *
 * Supply the ordinary URL-bound Effect socket layer beneath this decorator.
 * The cassette name identifies the connection; recorder configuration does not
 * duplicate the transport URL.
 */
export const socket = (name: string, options: RecorderOptions = {}): Layer.Layer<Socket.Socket, never, Socket.Socket> =>
  provideCassette(recordingLayer(name, { url: "" }, { ...options, compareClientMessagesAsJson: true }), options)

/** @internal */
export const socketLayer = (
  name: string,
  request: WebSocketRequest,
  options: WebSocketRecorderOptions & { readonly mode: "record" | "replay" },
): Layer.Layer<Socket.Socket, never, Socket.Socket> =>
  provideCassette(recordingLayer(name, request, options, options.mode), options)

const provideCassette = (
  layer: Layer.Layer<Socket.Socket, never, Socket.Socket | CassetteService.Service>,
  options: WebSocketRecorderOptions,
) =>
  layer.pipe(
    Layer.provide(CassetteService.fileSystem({ directory: options.directory })),
    Layer.provide(NodeFileSystem.layer),
  )
