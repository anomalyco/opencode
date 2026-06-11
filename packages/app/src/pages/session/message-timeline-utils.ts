import type { JSX } from "solid-js"
import type { MarkdownStage } from "@opencode-ai/ui/markdown"

const markdownStageRank = {
  lite: 0,
  structure: 1,
  full: 2,
} as const

export function itemStyle(centered: boolean): JSX.CSSProperties {
  if (!centered) return {}
  return {
    "max-width": "var(--session-content-width, 60rem)",
    "margin-left": "auto",
    "margin-right": "auto",
  }
}

export function timelineVirtualizationEnabled(value: string | null | undefined): boolean {
  return value === "1"
}

export function timelineHeightCacheEnabled(value: string | null | undefined): boolean {
  return value === "1"
}

function readMarkdownStage(value: string | undefined): MarkdownStage | undefined {
  if (value === "lite") return "lite"
  if (value === "structure") return "structure"
  if (value === "full") return "full"
  return undefined
}

function intersectsViewport(node: Element, viewport: DOMRect): boolean {
  const rect = node.getBoundingClientRect()
  return rect.bottom >= viewport.top && rect.top <= viewport.bottom
}

function markdownNodeReady(node: HTMLElement): boolean {
  const desired = readMarkdownStage(node.dataset.markdownStage)
  const rendered = readMarkdownStage(node.dataset.markdownRenderedStage)
  if (!desired) return true
  if (!rendered) return false
  if (desired === "full") return rendered === "full"
  return markdownStageRank[rendered] >= markdownStageRank.structure
}

export function visibleMarkdownRenderReady(input: {
  viewport: HTMLElement
  content: HTMLElement
  hasRenderableTurns: boolean
}): boolean {
  const turns = Array.from(input.content.querySelectorAll<HTMLElement>("[data-message-id]"))
  if (turns.length === 0) return !input.hasRenderableTurns

  const viewportRect = input.viewport.getBoundingClientRect()
  let markdownCount = 0

  for (const turn of turns) {
    if (!intersectsViewport(turn, viewportRect)) continue

    const markdownNodes = Array.from(turn.querySelectorAll<HTMLElement>('[data-component="markdown"]'))
    for (const markdown of markdownNodes) {
      if (!intersectsViewport(markdown, viewportRect)) continue
      markdownCount += 1
      if (!markdownNodeReady(markdown)) return false
    }
  }

  return markdownCount > 0 || turns.some((turn) => intersectsViewport(turn, viewportRect))
}
