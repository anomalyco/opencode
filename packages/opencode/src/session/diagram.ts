export * as SessionDiagram from "./diagram"

import { Effect, Schema, Context } from "effect"
import { PartID, SessionID } from "./schema"
import { EventV2 } from "@opencode-ai/core/event"

const MERMAID_BLOCK_RE = /```mermaid\n([\s\S]*?)```/g

export interface MermaidBlock {
  source: string
  start: number
  end: number
}

export function extractMermaidBlocks(text: string): MermaidBlock[] {
  const blocks: MermaidBlock[] = []
  let match: RegExpExecArray | null
  while ((match = MERMAID_BLOCK_RE.exec(text)) !== null) {
    blocks.push({
      source: match[1].trim(),
      start: match.index,
      end: match.index + match[0].length,
    })
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

export interface Interface {
  readonly detectAndReplace: (text: string) => Effect.Effect<{
    text: string
    blocks: MermaidBlock[]
  }>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionDiagram") {}
