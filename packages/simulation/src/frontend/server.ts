import { SimulationProtocol } from "../protocol"
import { SimulationActions, type Harness } from "./actions"
import { SimulationTrace } from "./trace"

const DefaultPort = 40900
const MaxPortAttempts = 100

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

function actionParam(params: unknown) {
  return SimulationProtocol.Frontend.decodeActionParams(params).action
}

function parseRequest(input: string | Buffer) {
  return SimulationProtocol.JsonRpc.decodeRequest(JSON.parse(typeof input === "string" ? input : input.toString()))
}

async function handle(harness: Harness, request: SimulationProtocol.JsonRpc.Request) {
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
          let request: SimulationProtocol.JsonRpc.Request | undefined
          try {
            request = parseRequest(message)
            const result = await handle(harness, request)
            const next = SimulationProtocol.JsonRpc.success(request.id, result)
            if (next) socket.send(JSON.stringify(next))
          } catch (error) {
            socket.send(JSON.stringify(SimulationProtocol.JsonRpc.failure(request?.id, error)))
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
