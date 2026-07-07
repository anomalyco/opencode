import { Effect } from "effect"
import { SimulationProtocol } from "../protocol"
import { SimulationLLMExchange } from "./llm-exchange"

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
 * - `llm.disconnect` { id } abruptly terminate an exchange without a finish
 * - `llm.pending`                 list open exchanges
 */

type ControlSocket = Bun.ServerWebSocket<{ unsubscribe?: () => void }>

function parseRequest(input: string | Buffer) {
  return SimulationProtocol.Backend.decodeRequest(JSON.parse(typeof input === "string" ? input : input.toString()))
}

async function handle(socket: ControlSocket, request: SimulationProtocol.Backend.Request): Promise<unknown> {
  switch (request.method) {
    case "llm.attach": {
      socket.data.unsubscribe?.()
      socket.data.unsubscribe = SimulationLLMExchange.subscribe((exchange) => {
        socket.send(JSON.stringify({ jsonrpc: "2.0", method: "llm.request", params: exchange }))
      })
      return { attached: true }
    }
    case "llm.chunk": {
      await Effect.runPromise(
        SimulationLLMExchange.push(
          request.params.id,
          request.params.items.map((item) => ({ type: "item", item }) as const),
        ),
      )
      return { ok: true }
    }
    case "llm.finish": {
      await Effect.runPromise(
        SimulationLLMExchange.push(request.params.id, [{ type: "finish", reason: request.params.reason }]),
      )
      return { ok: true }
    }
    case "llm.disconnect": {
      await Effect.runPromise(SimulationLLMExchange.disconnect(request.params.id))
      return { ok: true }
    }
    case "llm.pending":
      return { exchanges: SimulationLLMExchange.pending() }
  }
}

export function start(endpoint: string) {
  const url = new URL(endpoint)
  const server = Bun.serve<{ unsubscribe?: () => void }>({
    hostname: url.hostname,
    port: Number(url.port),
    fetch(request, server) {
      if (server.upgrade(request, { data: {} })) return undefined
      return new Response("opencode drive backend websocket", { status: 426 })
    },
    websocket: {
      close(socket) {
        socket.data.unsubscribe?.()
      },
      async message(socket, message) {
        let request: SimulationProtocol.Backend.Request | undefined
        try {
          request = parseRequest(message)
          const result = await handle(socket, request)
          const response = SimulationProtocol.JsonRpc.success(request.id, result)
          if (response) socket.send(JSON.stringify(response))
        } catch (error) {
          socket.send(JSON.stringify(SimulationProtocol.JsonRpc.failure(request?.id, error)))
        }
      },
    },
  })
  process.stderr.write(`opencode drive backend websocket: ${endpoint}\n`)
  return {
    url: endpoint,
    stop: () => {
      server.stop(true)
    },
  }
}

export * as SimulationControl from "./control"
