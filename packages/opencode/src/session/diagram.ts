export * as SessionDiagram from "./diagram"

import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer, Schema } from "effect"
import { SessionID } from "./schema"
import { EventV2 } from "@opencode-ai/core/event"

const MERMAID_BLOCK_RE = /```mermaid\n?([\s\S]*?)```/g

export interface MermaidBlock {
  source: string
  index: number
}

export function extractMermaidBlocks(text: string): MermaidBlock[] {
  const blocks: MermaidBlock[] = []
  let match: RegExpExecArray | null
  while ((match = MERMAID_BLOCK_RE.exec(text)) !== null) {
    blocks.push({ source: match[1].trim(), index: match.index })
  }
  return blocks
}

export const DiagramRendered = EventV2.define({
  type: "session.diagram.rendered",
  schema: {
    sessionID: SessionID,
    source: Schema.String,
  },
})

export function textWithoutMermaid(text: string): string {
  const cleaned = text.replace(MERMAID_BLOCK_RE, "").trim()
  return cleaned || "[Mermaid diagram generated]"
}

export interface Interface {
  readonly render: (source: string) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionDiagram") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const render = Effect.fn("SessionDiagram.render")(function* (source: string) {
      try {
        const { default: mermaid } = yield* Effect.promise(() => import("mermaid"))
        mermaid.initialize({ startOnLoad: false })
        const svg = yield* Effect.promise(async () => {
          const { svg } = await mermaid.render("d" + Date.now(), source)
          return svg
        })
        return svg
      } catch {
        return ""
      }
    })
    return Service.of({ render })
  }),
)

export { layer }

export const node = LayerNode.make({ service: Service, layer, deps: [] })
