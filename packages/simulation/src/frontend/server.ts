import type { CapturedFrame } from "@opentui/core"
import { SimulationProtocol } from "../protocol"
import { SimulationActions, type Harness } from "./actions"

export interface Server {
  readonly url: string
  readonly stop: () => void
}

function parseRequest(input: string | Buffer) {
  return SimulationProtocol.Frontend.decodeRequest(JSON.parse(typeof input === "string" ? input : input.toString()))
}

interface Recording {
  readonly frames: CapturedFrame[]
  readonly timer: ReturnType<typeof setInterval>
  pending: Promise<void>
}

async function handle(
  harness: Harness,
  request: SimulationProtocol.Frontend.Request,
  recording: { current?: Recording },
  headless: boolean,
) {
  switch (request.method) {
    case "ui.screenshot":
      return SimulationActions.screenshot(harness)
    case "ui.state": {
      return SimulationActions.state(harness)
    }
    case "ui.start-record": {
      if (recording.current) throw new Error("UI recording is already active")
      const frames = [SimulationActions.frame(harness)]
      const current: Recording = {
        frames,
        timer: setInterval(() => {
          current.pending = current.pending.then(async () => {
            if (headless) await harness.renderOnce()
            frames.push(SimulationActions.frame(harness))
          })
        }, 100),
        pending: Promise.resolve(),
      }
      recording.current = current
      return { recording: true }
    }
    case "ui.end-record": {
      if (!recording.current) throw new Error("UI recording is not active")
      const current = recording.current
      clearInterval(current.timer)
      await current.pending
      if (headless) await harness.renderOnce()
      current.frames.push(SimulationActions.frame(harness))
      recording.current = undefined
      return SimulationActions.video(current.frames)
    }
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

export function start(harness: Harness, endpoint: string, headless: boolean): Server {
  const url = new URL(endpoint)
  const recording: { current?: Recording } = {}
  const server = Bun.serve<{ readonly drive: true; readonly headless: boolean }>({
    hostname: url.hostname,
    port: Number(url.port),
    fetch(request, server) {
      if (server.upgrade(request, { data: { drive: true, headless } })) return undefined
      return new Response("opencode drive ui websocket", { status: 426 })
    },
    websocket: {
      async message(socket, message) {
        let request: SimulationProtocol.Frontend.Request | undefined
        try {
          request = parseRequest(message)
          const result = await handle(harness, request, recording, headless)
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
      if (recording.current) clearInterval(recording.current.timer)
      server.stop(true)
    },
  }
}

export * as SimulationServer from "./server"
