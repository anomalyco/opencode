import { LayerNode } from "@opencode-ai/core/effect/layer-node"

/**
 * Layer replacements applied when the server is built in simulation mode.
 *
 * Empty for now; simulation-mode implementations will populate this with
 * replacement nodes/layers that swap real services for simulated ones (e.g.
 * a fake filesystem). The server merges these into the app node build when
 * `OPENCODE_SIMULATION` is enabled, via a dynamic import so this module is
 * never loaded eagerly.
 */
export const simulationReplacements: LayerNode.Replacements = []

export * as Simulation from "./index"
