import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Effect } from "effect"
import { SimulationControlServer } from "../control-server"
import { SimulationProtocol } from "../protocol"
import { SimulationActions, type Harness } from "./actions"
import { SimulationRenderer } from "./renderer"

function handle(harness: Harness, request: SimulationProtocol.Frontend.Request) {
  switch (request.method) {
    case "simulation.handshake":
      return SimulationProtocol.Handshake.dispatch(
        {
          role: "ui",
          server: { name: "opencode", version: InstallationVersion },
          capabilities: SimulationProtocol.Frontend.Capabilities,
        },
        request.params,
      )
    case "ui.capture":
      return SimulationActions.capture(harness)
    case "ui.screenshot":
      return SimulationActions.screenshot(harness, request.params?.name)
    case "ui.state":
      return Effect.sync(() => SimulationActions.state(harness))
    case "ui.matches":
      return Effect.sync(() => SimulationActions.matches(harness, request.params.text))
    case "ui.recording.finish":
      return SimulationRenderer.finish(harness.renderer)
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
    case "ui.resize":
      return SimulationActions.execute(harness, {
        type: "ui.resize",
        cols: request.params.cols,
        rows: request.params.rows,
      })
  }
}

export const start = Effect.fn("SimulationServer.start")(function* (harness: Harness, endpoint: string) {
  return yield* SimulationControlServer.start({
    endpoint,
    label: "opencode drive ui websocket",
    data: () => ({ drive: true as const }),
    decode: SimulationProtocol.Frontend.decodeRequestEffect,
    handle: (_socket, request) => handle(harness, request),
  })
})

export * as SimulationServer from "./server"
