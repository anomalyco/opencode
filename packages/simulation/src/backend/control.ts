import { Effect, Schema } from "effect"
import { SimulationLLMExchange } from "./llm-exchange"
import { SimulationNetwork } from "./network"

/**
 * Backend-hosted simulation control WebSocket.
 *
 * JSON-RPC 2.0 over a loopback WebSocket, mirroring the protocol of the TUI
 * simulation server. Drivers connect directly (standalone topology; no
 * frontend proxy) to answer LLM exchanges and inspect the simulated network.
 * This is also the headless-simulation interface: it works with no TUI at
 * all.
 *
 * Methods:
 * - `llm.attach`            -> subscribe; pending and future exchanges arrive
 *                              as `llm.request` notifications
 * - `llm.chunk`   { id, items }   append response items to an exchange
 * - `llm.finish`  { id, reason? } finish an exchange
 * - `llm.pending`                 list open exchanges
 * - `network.log`                 simulated network request log
 */

const DefaultPort = 40950
const MaxPortAttempts = 100

const ChunkItem = Schema.Union([
  Schema.Struct({ type: Schema.Literal("textDelta"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("reasoningDelta"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("toolCall"), id: Schema.String, name: Schema.String, input: Schema.Unknown }),
  Schema.Struct({ type: Schema.Literal("raw"), chunk: Schema.Unknown }),
])

const ChunkParams = Schema.Struct({ id: Schema.String, items: Schema.Array(ChunkItem) })

const FinishParams = Schema.Struct({
  id: Schema.String,
  reason: Schema.Literals(["stop", "tool-calls", "length", "content-filter"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("stop" as const)),
  ),
})

const decodeChunkParams = Schema.decodeUnknownPromise(ChunkParams)
const decodeFinishParams = Schema.decodeUnknownPromise(FinishParams)

type JsonRpcRequest = {
  readonly jsonrpc: "2.0"
  readonly id?: string | number | null
  readonly method: string
  readonly params?: unknown
}

type ControlSocket = Bun.ServerWebSocket<{ unsubscribe?: () => void }>

function parseRequest(input: string | Buffer): JsonRpcRequest {
  const value = JSON.parse(typeof input === "string" ? input : input.toString()) as unknown
  if (typeof value !== "object" || value === null) throw new Error("Invalid JSON-RPC request")
  if (!("jsonrpc" in value) || value.jsonrpc !== "2.0") throw new Error("Invalid JSON-RPC version")
  if (!("method" in value) || typeof value.method !== "string") throw new Error("Invalid JSON-RPC method")
  return value as JsonRpcRequest
}

async function handle(socket: ControlSocket, request: JsonRpcRequest): Promise<unknown> {
  switch (request.method) {
    case "llm.attach": {
      socket.data.unsubscribe?.()
      socket.data.unsubscribe = SimulationLLMExchange.subscribe((exchange) => {
        socket.send(JSON.stringify({ jsonrpc: "2.0", method: "llm.request", params: exchange }))
      })
      return { attached: true }
    }
    case "llm.chunk": {
      const params = await decodeChunkParams(request.params)
      await Effect.runPromise(
        SimulationLLMExchange.push(
          params.id,
          params.items.map((item) => ({ type: "item", item }) as const),
        ),
      )
      return { ok: true }
    }
    case "llm.finish": {
      const params = await decodeFinishParams(request.params)
      await Effect.runPromise(SimulationLLMExchange.push(params.id, [{ type: "finish", reason: params.reason }]))
      return { ok: true }
    }
    case "llm.pending":
      return { exchanges: SimulationLLMExchange.pending() }
    case "network.log":
      return { entries: SimulationNetwork.log() }
  }
  throw new Error(`Unknown simulation control method: ${request.method}`)
}

function serve(port = DefaultPort, attempts = MaxPortAttempts): Bun.Server<{ unsubscribe?: () => void }> {
  try {
    return Bun.serve<{ unsubscribe?: () => void }>({
      hostname: "127.0.0.1",
      port,
      fetch(request, server) {
        if (server.upgrade(request, { data: {} })) return undefined
        return new Response("opencode simulation control websocket", { status: 426 })
      },
      websocket: {
        close(socket) {
          socket.data.unsubscribe?.()
        },
        async message(socket, message) {
          let request: JsonRpcRequest | undefined
          try {
            request = parseRequest(message)
            const result = await handle(socket, request)
            if (request.id !== undefined) socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }))
          } catch (error) {
            socket.send(
              JSON.stringify({
                jsonrpc: "2.0",
                id: request?.id ?? null,
                error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
              }),
            )
          }
        },
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
    const unavailable = message.includes("eaddrinuse") || message.includes("in use")
    if (!unavailable || attempts <= 1 || port >= 65535) throw error
    return serve(port + 1, attempts - 1)
  }
}

export function start() {
  const server = serve()
  const url = `ws://${server.hostname}:${server.port}`
  process.stderr.write(`opencode simulation backend control websocket: ${url}\n`)
  return {
    url,
    stop: () => {
      server.stop(true)
    },
  }
}

export * as SimulationControl from "./control"
