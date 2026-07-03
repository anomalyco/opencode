import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { filesystem, httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { SimulationControl } from "./control"
import { SimulationFileSystem } from "./filesystem"
import { SimulationFSUtil } from "./fs-util"
import { SimulationNetwork } from "./network"
import { SimulationOpenAI } from "./openai"

/**
 * Layer replacements applied when the server is built in simulation mode.
 *
 * The server merges these into the app node build when `OPENCODE_SIMULATION`
 * is enabled, via a dynamic import so this module is never loaded eagerly.
 *
 * - Filesystem: in-memory tree rooted at `OPENCODE_SIMULATION_ROOT` (the real,
 *   empty anchor directory the runner created and chdir'd into). Everything
 *   under the root lives in memory; paths outside it fail loudly.
 * - Network: all outbound HTTP resolves against the simulated route table;
 *   unknown destinations are denied. The driver-answered OpenAI endpoint is
 *   registered here as the first route.
 *
 * Loading this module also starts the backend simulation control WebSocket,
 * which drivers connect to directly for LLM exchange control and network
 * inspection (standalone topology; also the headless-simulation interface).
 */

SimulationNetwork.register(SimulationOpenAI.route)
// ModelsDev dies when its catalog fetch fails, so simulation answers it with
// an empty catalog; providers come from seeded config instead.
SimulationNetwork.register(SimulationNetwork.json("GET", "https://models.dev/api.json", {}))

SimulationControl.start()

export const simulationReplacements: LayerNode.Replacements = [
  [filesystem, SimulationFileSystem.layer({ root: process.env.OPENCODE_SIMULATION_ROOT })],
  [FSUtil.node, SimulationFSUtil.node],
  [httpClient, SimulationNetwork.layer],
]

export * as Simulation from "./index"
