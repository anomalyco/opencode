import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { DriveManifest } from "../manifest"
import { SimulationControl } from "./control"
import { SimulationNetwork } from "./network"
import { SimulationOpenAI } from "./openai"

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

SimulationNetwork.register(SimulationOpenAI.route)
// ModelsDev dies when its catalog fetch fails, so simulation answers it with
// an empty catalog; providers come from seeded config instead.
SimulationNetwork.register(SimulationNetwork.json("GET", "https://models.dev/api.json", {}))

export function startDriveServer() {
  return SimulationControl.start(DriveManifest.resolve().endpoints.backend)
}

export const simulationReplacements: LayerNode.Replacements = [
  [httpClient, SimulationNetwork.layer],
]

export * as Simulation from "./index"
