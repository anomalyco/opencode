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

export type Socket = Bun.ServerWebSocket<SocketData>

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
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve<SocketData>({
          hostname: url.hostname,
          port: Number(url.port),
          fetch(request, server) {
            if (server.upgrade(request, { data: options.data() })) return undefined
            return new Response(options.label, { status: 426 })
          },
          websocket: {
            close(socket) {
              socket.data.closed = true
              Queue.offerUnsafe(closures, socket)
            },
            message(socket, message) {
              const input = typeof message === "string" ? message : message.toString()
              if (Queue.offerUnsafe(messages, { socket, input })) return
              socket.send(
                JSON.stringify(
                  SimulationProtocol.JsonRpc.failure(undefined, new Error("Simulation control queue is full")),
                ),
              )
            },
          },
        }),
      ),
      (server) => Effect.promise(() => server.stop(true)),
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
