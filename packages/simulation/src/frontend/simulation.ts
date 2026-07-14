import { createCliRenderer, type CliRendererConfig } from "@opentui/core"
import { Config, Effect } from "effect"
import { DriveManifest } from "../manifest"
import { SimulationActions } from "./actions"
import { SimulationRenderer } from "./renderer"
import { SimulationServer } from "./server"

/** Drive-mode renderer and control-server acquisition. */
export const create = Effect.fn("Drive.create")(function* (options: CliRendererConfig) {
  const headless = (yield* Config.string("OPENCODE_DRIVE_RENDERER").pipe(Config.withDefault("visible"))) === "headless"
  const manifest = yield* DriveManifest.resolve()
  const renderer = headless
    ? yield* SimulationRenderer.create(options, manifest.recording?.timeline, manifest.viewport)
    : yield* Effect.acquireRelease(
        Effect.tryPromise(() => createCliRenderer(options)),
        (renderer) =>
          Effect.sync(() => {
            if (!renderer.isDestroyed) renderer.destroy()
          }),
      )
  if (!headless && manifest.viewport) renderer.resize(manifest.viewport.cols, manifest.viewport.rows)
  const server = yield* SimulationServer.start(SimulationActions.createHarness(renderer), manifest.endpoints.ui)
  yield* Effect.sync(() => process.stderr.write(`opencode drive ui websocket: ${server.url}\n`))
  return renderer
})

export * as Drive from "./simulation"
