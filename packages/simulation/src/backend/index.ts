import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { Config, Effect, Layer } from "effect"
import { HttpClient } from "effect/unstable/http"
import { DriveManifest } from "../manifest"
import { SimulationNetwork } from "./network"
import { SimulationOpenAI } from "./openai"
import { SimulatedProvider } from "./simulated-provider"

/**
 * Layer replacements applied when the server is built in simulation mode.
 *
 * The server merges these into the app node build when `OPENCODE_SIMULATE`
 * is enabled, via a dynamic import so this module is never loaded eagerly.
 *
 * - Network: all outbound HTTP resolves against the simulated route table;
 *   unknown destinations are denied. The driver-answered OpenAI endpoint is
 *   registered here as the first route.
 *
 */

export const simulationReplacements = Effect.fn("Simulation.replacements")(function* () {
  // ModelsDev dies when its catalog fetch fails, so simulation answers it with
  // an empty catalog; providers come from seeded config instead.
  const models = SimulationNetwork.json("GET", "https://models.dev/api.json", {})
  const drive = yield* Config.string("OPENCODE_DRIVE").pipe(Config.withDefault(undefined))
  if (!drive) return [[httpClient, SimulationNetwork.layer([models])]] satisfies LayerNode.Replacements

  const manifest = yield* DriveManifest.resolve()
  const networkLayer = Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
      const provider = yield* SimulatedProvider.Service
      const network = yield* SimulationNetwork.make([SimulationOpenAI.route(provider), models])
      return network.client
    }),
  ).pipe(
    Layer.provide(
      SimulatedProvider.layerDrive({
        endpoint: manifest.endpoints.backend,
      }),
    ),
  )
  return [[httpClient, networkLayer]] satisfies LayerNode.Replacements
})

export * as Simulation from "./index"
