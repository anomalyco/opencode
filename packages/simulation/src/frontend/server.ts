import { SimulationProtocol } from "../protocol"
import { SimulationActions, type Harness } from "./actions"

export interface Server {
  readonly url: string
  readonly stop: () => void
}

function parseRequest(input: string | Buffer) {
  return SimulationProtocol.Frontend.decodeRequest(JSON.parse(typeof input === "string" ? input : input.toString()))
}

async function handle(
  harness: Harness,
  request: SimulationProtocol.Frontend.Request,
  finishRecording?: () => Promise<string>,
) {
  switch (request.method) {
    case "ui.screenshot":
      return SimulationActions.screenshot(harness, request.params?.name)
    case "ui.state": {
      return SimulationActions.state(harness)
    }
    case "ui.recording.finish":
      if (!finishRecording) throw new Error("UI recording is not available")
      return finishRecording()
    case "ui.type":
      return SimulationActions.execute(harness, { type: "ui.type", text: request.params.text })
    case "ui.enter":
      return SimulationActions.execute(harness, { type: "ui.enter" })
    case "ui.press":
      return SimulationActions.execute(harness, {
        type: "ui.press",
        key: request.params.key,
        modifiers: request.params.modifiers,
      })
    case "ui.arrow":
      return SimulationActions.execute(harness, { type: "ui.arrow", direction: request.params.direction })
    case "ui.focus":
      return SimulationActions.execute(harness, { type: "ui.focus", target: request.params.target })
    case "ui.click":
      return SimulationActions.execute(harness, {
        type: "ui.click",
        target: request.params.target,
        x: request.params.x,
        y: request.params.y,
      })
  }
}

export function start(harness: Harness, endpoint: string, finishRecording?: () => Promise<string>): Server {
  const url = new URL(endpoint)
  const server = Bun.serve<{ readonly drive: true }>({
    hostname: url.hostname,
    port: Number(url.port),
    fetch(request, server) {
      if (server.upgrade(request, { data: { drive: true } })) return undefined
      return new Response("opencode drive ui websocket", { status: 426 })
    },
    websocket: {
      async message(socket, message) {
        let request: SimulationProtocol.Frontend.Request | undefined
        try {
          request = parseRequest(message)
          const result = await handle(harness, request, finishRecording)
          const next = SimulationProtocol.JsonRpc.success(request.id, result)
          if (next) socket.send(JSON.stringify(next))
        } catch (error) {
          socket.send(JSON.stringify(SimulationProtocol.JsonRpc.failure(request?.id, error)))
        }
      },
    },
  })
  return {
    url: endpoint,
    stop: () => {
      server.stop(true)
    },
  }
}

export * as SimulationServer from "./server"
