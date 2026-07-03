import { SimulationActions, type Action, type Harness } from "./actions"
import { SimulationTrace } from "./trace"

const DefaultPort = 40900
const MaxPortAttempts = 100

type JsonRpcRequest = {
  readonly jsonrpc: "2.0"
  readonly id?: string | number | null
  readonly method: string
  readonly params?: unknown
}

type JsonRpcResponse = {
  readonly jsonrpc: "2.0"
  readonly id: string | number | null
  readonly result?: unknown
  readonly error?: {
    readonly code: number
    readonly message: string
    readonly data?: unknown
  }
}

export interface Server {
  readonly url: string
  readonly stop: () => void
}

function isEnabled() {
  return process.env.OPENCODE_SIMULATION === "1" || process.env.OPENCODE_SIMULATION === "true"
}

function isPortUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return message.includes("eaddrinuse") || message.includes("address already in use") || message.includes(" in use")
}

function parseRequest(input: string | Buffer): JsonRpcRequest {
  const value = JSON.parse(typeof input === "string" ? input : input.toString()) as unknown
  if (typeof value !== "object" || value === null) throw new Error("Invalid JSON-RPC request")
  if (!("jsonrpc" in value) || value.jsonrpc !== "2.0") throw new Error("Invalid JSON-RPC version")
  if (!("method" in value) || typeof value.method !== "string") throw new Error("Invalid JSON-RPC method")
  return value as JsonRpcRequest
}

function isAction(input: unknown): input is Action {
  if (typeof input !== "object" || input === null || !("type" in input)) return false
  switch (input.type) {
    case "typeText":
      return "text" in input && typeof input.text === "string"
    case "pressKey":
      return "key" in input && typeof input.key === "string"
    case "pressEnter":
      return true
    case "pressArrow":
      return "direction" in input && ["up", "down", "left", "right"].includes(String(input.direction))
    case "focus":
      return "target" in input && typeof input.target === "number"
    case "click":
      return (
        "target" in input &&
        typeof input.target === "number" &&
        "x" in input &&
        typeof input.x === "number" &&
        "y" in input &&
        typeof input.y === "number"
      )
  }
  return false
}

function actionParam(params: unknown) {
  if (typeof params !== "object" || params === null || !("action" in params)) throw new Error("Missing action")
  if (!isAction(params.action)) throw new Error("Invalid action")
  return params.action
}

function response(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse | undefined {
  if (id === undefined) return undefined
  return { jsonrpc: "2.0", id, result }
}

function errorResponse(id: JsonRpcRequest["id"], error: unknown): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code: -32000,
      message: error instanceof Error ? error.message : String(error),
    },
  }
}

async function handle(harness: Harness, request: JsonRpcRequest) {
  switch (request.method) {
    case "ui.state": {
      const result = SimulationActions.state(harness)
      SimulationTrace.add("ui.state", { elements: result.elements.length, actions: result.actions.length })
      return result
    }
    case "ui.action":
      return SimulationActions.execute(harness, actionParam(request.params))
    case "ui.render": {
      await harness.renderOnce()
      const result = SimulationActions.state(harness)
      SimulationTrace.add("ui.render", { elements: result.elements.length, actions: result.actions.length })
      return result
    }
    case "trace.list":
      return { records: SimulationTrace.list() }
    case "trace.clear":
      SimulationTrace.clear()
      return { cleared: true }
    case "trace.export":
      return SimulationTrace.exportTrace()
  }
  throw new Error(`Unknown simulation method: ${request.method}`)
}

function serve(
  harness: Harness,
  port = DefaultPort,
  attempts = MaxPortAttempts,
): Bun.Server<{ readonly simulation: true }> {
  try {
    return Bun.serve<{ readonly simulation: true }>({
      hostname: "127.0.0.1",
      port,
      fetch(request, server) {
        if (server.upgrade(request, { data: { simulation: true } })) return undefined
        return new Response("opencode simulation websocket", { status: 426 })
      },
      websocket: {
        open() {
          SimulationTrace.add("control.connect")
        },
        close() {
          SimulationTrace.add("control.disconnect")
        },
        async message(socket, message) {
          let request: JsonRpcRequest | undefined
          try {
            request = parseRequest(message)
            const result = await handle(harness, request)
            const next = response(request.id, result)
            if (next) socket.send(JSON.stringify(next))
          } catch (error) {
            socket.send(JSON.stringify(errorResponse(request?.id, error)))
          }
        },
      },
    })
  } catch (error) {
    if (!isPortUnavailable(error) || attempts <= 1 || port >= 65535) throw error
    return serve(harness, port + 1, attempts - 1)
  }
}

export function start(harness: Harness): Server | undefined {
  if (!isEnabled()) return
  const server = serve(harness)
  const url = `ws://${server.hostname}:${server.port}`
  SimulationTrace.add("control.start", { url })
  return {
    url,
    stop: () => {
      SimulationTrace.add("control.stop", { url })
      server.stop(true)
    },
  }
}

export * as SimulationServer from "./server"
