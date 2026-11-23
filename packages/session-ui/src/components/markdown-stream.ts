import { createMarkdownStream, type MarkdownBlock, type PatchmarkStream } from "@opencode/patchmark"
import { isMathFence } from "@opencode/ui/context/marked-parser"
import { completedProjection } from "./markdown-projection"

export type Block = {
  raw: string
  src: string
  mode: "full" | "live" | "code"
  language?: string
  complete?: boolean
}

export type Projection = {
  text: string
  blocks: Block[]
}

const streams = new WeakMap<Projection, PatchmarkStream>()

const projectedBlocks = new WeakMap<MarkdownBlock, Block>()

function createStream() {
  return createMarkdownStream({
    gfm: true,
    math: true,
    heal: true,
    holdPendingMarkers: false,
    settleOnComplete: false,
    groupHtmlBlocks: true,
    renderHtml: false,
  })
}

function toBlock(block: MarkdownBlock): Block {
  const cached = projectedBlocks.get(block)

  if (cached) return cached

  // A closed math fence goes to the Markdown parser, which draws it as display math; while it streams it stays code.
  const math = block.kind.type === "code" && block.kind.complete && isMathFence(block.kind.language)

  if (!math && (block.kind.type === "code" || block.kind.type === "mermaid")) {
    const item: Block = {
      raw: block.raw,
      src: block.kind.source,
      mode: "code",
    }

    const language = block.kind.type === "mermaid" ? "mermaid" : block.kind.language

    if (language) item.language = language

    if (block.kind.complete || block.status === "settled") item.complete = true

    projectedBlocks.set(block, item)

    return item
  }

  const mode = math || block.status === "settled" ? "full" : "live"
  const defs = block.defs ? `\n\n${block.defs}` : ""
  const base = mode === "live" ? (block.liveRaw ?? block.raw) : block.raw

  const item: Block = {
    raw: block.raw,
    src: base + defs,
    mode,
  }

  projectedBlocks.set(block, item)

  return item
}

export function stream(text: string, live: boolean): Block[] {
  return project(undefined, text, live).blocks
}

export function project(previous: Projection | undefined, text: string, live: boolean): Projection {
  if (!previous && !live) return completedProjection(text)

  if (previous && live && previous.text === text) return previous

  const instance = (previous ? streams.get(previous) : undefined) ?? createStream()
  const blocks = instance.update(text, { streaming: live }).blocks.map(toBlock)

  const next: Projection = {
    text,
    blocks: blocks.length === 0 ? [{ raw: text, src: text, mode: live ? "live" : "full" }] : blocks,
  }

  if (live) streams.set(next, instance)

  return next
}
