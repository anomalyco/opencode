import { describe, expect, test } from "bun:test"
import {
  itemStyle,
  timelineHeightCacheEnabled,
  timelineVirtualizationEnabled,
  visibleMarkdownRenderReady,
} from "./message-timeline-utils"

function setRect(node: Element, top: number, bottom: number) {
  node.getBoundingClientRect = () =>
    ({
      x: 0,
      y: top,
      top,
      bottom,
      left: 0,
      right: 100,
      width: 100,
      height: Math.max(0, bottom - top),
      toJSON: () => ({}),
    }) as DOMRect
}

function createViewport() {
  const viewport = document.createElement("div")
  const content = document.createElement("div")
  setRect(viewport, 0, 600)
  viewport.appendChild(content)
  return { viewport, content }
}

function createTurn(input: { top?: number; bottom?: number; markdown?: HTMLElement }) {
  const turn = document.createElement("div")
  turn.dataset.messageId = "msg_1"
  setRect(turn, input.top ?? 0, input.bottom ?? 200)
  if (input.markdown) turn.appendChild(input.markdown)
  return turn
}

function createMarkdown(input: { top?: number; bottom?: number; stage?: string; renderedStage?: string }) {
  const markdown = document.createElement("div")
  markdown.dataset.component = "markdown"
  if (input.stage) markdown.dataset.markdownStage = input.stage
  if (input.renderedStage) markdown.dataset.markdownRenderedStage = input.renderedStage
  setRect(markdown, input.top ?? 0, input.bottom ?? 100)
  return markdown
}

describe("message timeline helpers", () => {
  test("keeps centered item layout without intrinsic size shortcuts", () => {
    const style = itemStyle(true)

    expect(style["max-width"]).toBe("var(--session-content-width, 60rem)")
    expect(style["margin-left"]).toBe("auto")
    expect(style["margin-right"]).toBe("auto")
    expect(style["content-visibility"]).toBeUndefined()
    expect(style["contain-intrinsic-size"]).toBeUndefined()
  })

  test("keeps timeline virtualization opt-in", () => {
    expect(timelineVirtualizationEnabled(null)).toBe(false)
    expect(timelineVirtualizationEnabled(undefined)).toBe(false)
    expect(timelineVirtualizationEnabled("0")).toBe(false)
    expect(timelineVirtualizationEnabled("1")).toBe(true)
  })

  test("keeps timeline height cache opt-in", () => {
    expect(timelineHeightCacheEnabled(null)).toBe(false)
    expect(timelineHeightCacheEnabled(undefined)).toBe(false)
    expect(timelineHeightCacheEnabled("0")).toBe(false)
    expect(timelineHeightCacheEnabled("1")).toBe(true)
  })

  test("waits for visible full markdown to commit to the DOM", () => {
    const { viewport, content } = createViewport()
    content.appendChild(createTurn({ markdown: createMarkdown({ stage: "full" }) }))

    expect(visibleMarkdownRenderReady({ viewport, content, hasRenderableTurns: true })).toBe(false)
  })

  test("accepts visible full markdown after full DOM commit", () => {
    const { viewport, content } = createViewport()
    content.appendChild(createTurn({ markdown: createMarkdown({ stage: "full", renderedStage: "full" }) }))

    expect(visibleMarkdownRenderReady({ viewport, content, hasRenderableTurns: true })).toBe(true)
  })

  test("keeps visible lite markdown hidden until at least structure is rendered", () => {
    const { viewport, content } = createViewport()
    content.appendChild(createTurn({ markdown: createMarkdown({ stage: "lite", renderedStage: "lite" }) }))

    expect(visibleMarkdownRenderReady({ viewport, content, hasRenderableTurns: true })).toBe(false)
  })

  test("ignores markdown outside the viewport", () => {
    const { viewport, content } = createViewport()
    content.appendChild(
      createTurn({
        top: 700,
        bottom: 900,
        markdown: createMarkdown({ top: 720, bottom: 760, stage: "full" }),
      }),
    )

    expect(visibleMarkdownRenderReady({ viewport, content, hasRenderableTurns: true })).toBe(false)
  })

  test("allows visible tool-only turns without markdown", () => {
    const { viewport, content } = createViewport()
    content.appendChild(createTurn({}))

    expect(visibleMarkdownRenderReady({ viewport, content, hasRenderableTurns: true })).toBe(true)
  })
})
