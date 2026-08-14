import { Effect, Fiber, FiberSet, Queue, Stream } from "effect"
import { SimulationProtocol } from "./protocol"

export interface Server {
  readonly url: string
}

interface Request {
  readonly id?: string | number | null
}

export interface SocketData {
  readonly drive?: true
  attachment?: Fiber.Fiber<void>
  closed?: true
}

export interface Socket {
  readonly data: SocketData
  readonly send: (message: string) => Effect.Effect<void>
}

const maxOutboundBytes = 64 * 1024 * 1024

export function start<RequestType extends Request, Error, Services>(options: {
  readonly endpoint: string
  readonly label: string
  readonly data: () => SocketData
  readonly decode: (input: string) => Effect.Effect<RequestType, Error>
  readonly handle: (socket: Socket, request: RequestType) => Effect.Effect<unknown, unknown, Services>
  readonly close?: (socket: Socket) => Effect.Effect<void, never, Services>
}) {
  return Effect.gen(function* () {
    const messages = yield* Queue.bounded<{ readonly socket: Socket; readonly input: string }>(256)
    yield* Stream.fromQueue(messages).pipe(
      Stream.runForEach((message) =>
        options.decode(message.input).pipe(
          Effect.flatMap((request) =>
            options.handle(message.socket, request).pipe(
              Effect.matchEffect({
                onFailure: (error) => send(message.socket, SimulationProtocol.JsonRpc.failure(request.id, error)),
                onSuccess: (result) => send(message.socket, SimulationProtocol.JsonRpc.success(request.id, result)),
              }),
            ),
          ),
          Effect.catch((error) => send(message.socket, SimulationProtocol.JsonRpc.failure(undefined, error))),
          Effect.catchCause((cause) => Effect.logWarning(`${options.label}: request failed`, cause)),
        ),
      ),
      Effect.forkScoped,
    )
    const url = yield* Effect.try({ try: () => new URL(options.endpoint), catch: (cause) => cause })
    const websocket = yield* Effect.promise(() => import("ws"))
    const runPromise = yield* FiberSet.makeRuntimePromise<Services, void, never>()
    yield* Effect.acquireRelease(
      Effect.tryPromise(
        () =>
          new Promise<{
            readonly close: () => Promise<void>
          }>((resolve, reject) => {
            const server = new websocket.WebSocketServer({ host: url.hostname, port: Number(url.port) })
            const sockets = new Map<
              InstanceType<typeof websocket.WebSocket>,
              { socket: Socket; cleanup: () => Promise<void> }
            >()
            const report = (scope: string, cause: unknown) =>
              void runPromise(Effect.logWarning(`${options.label}: ${scope} error`, cause))
            const onServerError = (cause: Error) => report("server", cause)
            const onStartupError = (cause: Error) => {
              server.off("listening", onListening)
              server.on("error", onServerError)
              reject(cause)
            }
            const onListening = () => {
              server.off("error", onStartupError)
              server.on("error", onServerError)
              resolve({
                close: async () => {
                  const accepted = Array.from(sockets.entries())
                  accepted.forEach(([connection, record]) => {
                    record.socket.data.closed = true
                    connection.terminate()
                  })
                  await Promise.all([
                    new Promise<void>((resolveClose, rejectClose) => {
                      server.close((cause) => (cause ? rejectClose(cause) : resolveClose()))
                      // Bun releases the listener but does not invoke ws' close callback after an upgraded socket.
                      queueMicrotask(() => {
                        if (server.address() === null) resolveClose()
                      })
                    }),
                    Promise.all(accepted.map(([, record]) => record.cleanup())),
                  ])
                  server.off("error", onServerError)
                },
              })
            }
            server.once("listening", onListening)
            server.once("error", onStartupError)
            server.on("connection", (connection) => {
              let pendingBytes = 0
              let outbound = Promise.resolve()
              let cleanup: Promise<void> | undefined
              const socket: Socket = {
                data: options.data(),
                send: (message) =>
                  Effect.tryPromise({
                    try: () => {
                      const bytes = Buffer.byteLength(message)
                      if (bytes > maxOutboundBytes || pendingBytes + bytes > maxOutboundBytes)
                        return Promise.reject(new Error(`Simulation outbound queue exceeds ${maxOutboundBytes} bytes`))
                      pendingBytes += bytes
                      const current = outbound.then(
                        () =>
                          new Promise<void>((resolveSend, rejectSend) => {
                            if (connection.readyState !== websocket.WebSocket.OPEN) {
                              rejectSend(new Error("Simulation control socket is not open"))
                              return
                            }
                            connection.send(message, (cause) => (cause ? rejectSend(cause) : resolveSend()))
                          }),
                      )
                      outbound = current.catch(() => undefined)
                      return current.finally(() => {
                        pendingBytes -= bytes
                      })
                    },
                    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
                  }).pipe(
                    Effect.tapError(() =>
                      Effect.sync(() => {
                        connection.terminate()
                      }),
                    ),
                    Effect.orDie,
                  ),
              }
              const close = () => {
                socket.data.closed = true
                cleanup ??= runPromise(options.close?.(socket) ?? Effect.void).finally(() => sockets.delete(connection))
                return cleanup
              }
              sockets.set(connection, { socket, cleanup: close })
              connection.on("close", () => void close())
              connection.on("error", (cause) => {
                report("socket", cause)
                connection.terminate()
              })
              connection.on("message", (message) => {
                const input = Array.isArray(message)
                  ? Buffer.concat(message).toString()
                  : message instanceof ArrayBuffer
                    ? Buffer.from(message).toString()
                    : message.toString()
                if (Queue.offerUnsafe(messages, { socket, input })) return
                void runPromise(
                  socket
                    .send(
                      JSON.stringify(
                        SimulationProtocol.JsonRpc.failure(undefined, new Error("Simulation control queue is full")),
                      ),
                    )
                    .pipe(
                      Effect.catchCause((cause) =>
                        Effect.logWarning(`${options.label}: queue rejection failed`, cause),
                      ),
                    ),
                )
              })
            })
          }),
      ),
      ({ close }) => Effect.promise(close),
    )
    return { url: options.endpoint } satisfies Server
  })
}

function send(socket: Socket, response: SimulationProtocol.JsonRpc.Response | undefined) {
  if (!response) return Effect.void
  return socket.send(JSON.stringify(response))
}

export * as SimulationControlServer from "./control-server"
