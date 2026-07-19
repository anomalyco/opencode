export * as SimulationSemantics from "./semantics"

import type { Renderable } from "@opentui/core"
import type { SimulationProtocol } from "../protocol"

// Semantic renderables set an explicit stable OpenTUI id so ui.state and
// ui.snapshot expose the same identity. Hierarchy and element handles come
// from the live render tree.
export type Definition = Omit<SimulationProtocol.Frontend.SemanticNode, "id" | "element" | "parent">

const definitions = new WeakMap<Renderable, () => Definition>()

export const bind = (definition: () => Definition) => (renderable: Renderable) => {
  definitions.set(renderable, definition)
}

export const read = (renderable: Renderable) => definitions.get(renderable)
