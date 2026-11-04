import type { Renderable } from "@opentui/core"
import type { SimulationProtocol } from "../protocol"

// Semantic renderables set an explicit stable OpenTUI id so ui.state and
// ui.snapshot expose the same identity. Hierarchy and element handles come
// from the live render tree.
export type Definition = Omit<SimulationProtocol.Frontend.SemanticNode, "id" | "element" | "parent">

const key = Symbol.for("opencode.simulation.semantics")
type SemanticRenderable = Renderable & { [key]?: () => Definition }

const bind = (definition: () => Definition) => (renderable: Renderable) => {
  Object.defineProperty(renderable, key, { value: definition, configurable: true })
}

export const read = (renderable: Renderable) => (renderable as SemanticRenderable)[key]

export const SimulationSemantics = { bind, read }
