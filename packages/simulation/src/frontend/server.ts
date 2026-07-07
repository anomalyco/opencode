import { SimulationProtocol } from "../protocol"
import { SimulationActions, type Harness } from "./actions"
import { SimulationTrace } from "./trace"

export interface Server {
  readonly url: string
  readonly stop: () => void
}

function parseRequest(input: string | Buffer) {
  return SimulationProtocol.Frontend.decodeRequest(JSON.parse(typeof input === "string" ? input : input.toString()))
}

async function handle(harness: Harness, request: SimulationProtocol.Frontend.Request) {
  switch (request.method) {
    case "ui.render":
      return
    case "ui.state": {
      const result = SimulationActions.state(harness)
      SimulationTrace.add("ui.state", { elements: result.elements.length, actions: result.actions.length })
      return result
    }
    case "ui.action":
      return SimulationActions.execute(harness, request.params.action)
    case "trace.list":
      return { records: SimulationTrace.list() }
    case "trace.clear":
      SimulationTrace.clear()
      return { cleared: true }
    case "trace.export":
      return SimulationTrace.exportTrace()
  }
}

export function start(harness: Harness, endpoint: string, headless: boolean): Server {
  const url = new URL(endpoint)
  const server = Bun.serve<{ readonly drive: true; readonly headless: boolean }>({
    hostname: url.hostname,
    port: Number(url.port),
    fetch(request, server) {
      if (server.upgrade(request, { data: { drive: true, headless } })) return undefined
      return new Response("opencode drive ui websocket", { status: 426 })
    },
    websocket: {
      open() {
        SimulationTrace.add("control.connect")
      },
      close() {
        SimulationTrace.add("control.disconnect")
      },
      async message(socket, message) {
        let request: SimulationProtocol.Frontend.Request | undefined
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
  SimulationTrace.add("control.start", { url: endpoint })
  return {
    url: endpoint,
    stop: () => {
      SimulationTrace.add("control.stop", { url: endpoint })
      server.stop(true)
    },
  }
}

export * as SimulationServer from "./server"
