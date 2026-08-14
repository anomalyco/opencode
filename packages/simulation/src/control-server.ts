import { Effect, Fiber, Queue, Stream } from "effect"
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
  readonly send: (message: string) => void
}

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
    const closures = yield* Queue.unbounded<Socket>()
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
        ),
      ),
      Effect.forkScoped,
    )
    yield* Stream.fromQueue(closures).pipe(
      Stream.runForEach((socket) => options.close?.(socket) ?? Effect.void),
      Effect.forkScoped,
    )
    const url = yield* Effect.try({ try: () => new URL(options.endpoint), catch: (cause) => cause })
    const websocket = yield* Effect.promise(() => import("ws"))
    yield* Effect.acquireRelease(
      Effect.tryPromise(
        () =>
          new Promise<InstanceType<typeof websocket.WebSocketServer>>((resolve, reject) => {
            const server = new websocket.WebSocketServer({ host: url.hostname, port: Number(url.port) })
            server.once("listening", () => resolve(server))
            server.once("error", reject)
            server.on("connection", (connection) => {
              const socket: Socket = {
                data: options.data(),
                send: (message) => connection.send(message),
              }
              connection.on("close", () => {
                socket.data.closed = true
                Queue.offerUnsafe(closures, socket)
              })
              connection.on("message", (message) => {
                if (Queue.offerUnsafe(messages, { socket, input: message.toString() })) return
                socket.send(
                  JSON.stringify(
                    SimulationProtocol.JsonRpc.failure(undefined, new Error("Simulation control queue is full")),
                  ),
                )
              })
            })
          }),
      ),
      (server) =>
        Effect.sync(() => {
          server.clients.forEach((client) => client.terminate())
          server.close()
        }),
    )
    return { url: options.endpoint } satisfies Server
  })
}

function send(socket: Socket, response: SimulationProtocol.JsonRpc.Response | undefined) {
  if (!response) return Effect.void
  return Effect.sync(() => {
    socket.send(JSON.stringify(response))
  })
}

export * as SimulationControlServer from "./control-server"
