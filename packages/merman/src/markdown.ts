import {
  TextBufferRenderable,
  RenderableEvents,
  createMarkdownCodeBlockRenderer,
  parseColor,
  type ColorInput,
  type MarkdownOptions,
  type MouseEvent,
  type RenderContext,
  type RGBA,
  type StyledText,
} from "@opentui/core"
import { MermaidSyntaxError } from "./diagnostics.js"
import { detectMermaidDiagram } from "./detect.js"
import { drawFlowchartDiagramGrid } from "./flowchart/drawing.js"
import { parseMermaidFlowchartDiagram } from "./flowchart/parser.js"
import { renderGridStyledText, resolveFlowchartStyleColors } from "./flowchart/style.js"
import { drawSequenceDiagramGrid } from "./sequence/drawing.js"
import { parseMermaidSequenceDiagram } from "./sequence/parser.js"
import { renderSequenceGridStyledText } from "./sequence/render-grid.js"
import { resolveSequenceStyleColors } from "./sequence/style.js"
import { drawStateDiagramGrid } from "./state/drawing.js"
import { parseMermaidStateDiagram } from "./state/parser.js"
import { renderStateGridStyledText } from "./state/render-grid.js"
import { resolveStateStyleColors } from "./state/style.js"

type DiagramKind = NonNullable<ReturnType<typeof detectMermaidDiagram>>

interface LastGoodDiagram {
  readonly kind: DiagramKind
  readonly source: string
}

export interface MermaidMarkdownRendererOptions {
  compact?: boolean
  colors?: {
    text?: ColorInput
    primary?: ColorInput
    secondary?: ColorInput
    muted?: ColorInput
    warning?: ColorInput
    background?: ColorInput
  }
}

function color(value: ColorInput | undefined): RGBA | undefined {
  return value === undefined ? undefined : parseColor(value)
}

class StaticDiagramRenderable extends TextBufferRenderable {
  constructor(ctx: RenderContext, text: StyledText, height: number) {
    super(ctx, { width: "100%", height, wrapMode: "none", selectable: false, marginTop: 1 })
    this.textBuffer.setStyledText(text)
    this.updateTextInfo()

    let dragX: number | undefined
    this.onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return
      ctx.clearSelection()
      dragX = event.x
      event.preventDefault()
      event.stopPropagation()
    }
    this.onMouseDrag = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (dragX === undefined) return
      const dx = event.x - dragX
      dragX = event.x
      if (dx) this.scrollX -= dx
    }
    this.onMouseDragEnd = (event: MouseEvent) => {
      dragX = undefined
      event.preventDefault()
      event.stopPropagation()
    }
    this.onMouseUp = (event: MouseEvent) => {
      if (event.button !== 0) return
      dragX = undefined
      event.preventDefault()
      event.stopPropagation()
    }
    this.onMouseScroll = (event: MouseEvent) => {
      const scroll = event.scroll
      if (!scroll || (scroll.direction !== "left" && scroll.direction !== "right")) return
      this.scrollX += (scroll.direction === "right" ? 1 : -1) * scroll.delta
      event.preventDefault()
      event.stopPropagation()
    }
  }
}

function renderDiagram(
  ctx: RenderContext,
  kind: DiagramKind,
  source: string,
  options: MermaidMarkdownRendererOptions,
): StaticDiagramRenderable {
  const colors = options.colors ?? {}
  switch (kind) {
    case "flowchart": {
      const grid = drawFlowchartDiagramGrid(parseMermaidFlowchartDiagram(source), { compact: options.compact })
      const size = grid.getTextSize({ trimTop: true, trimBottom: true })
      return new StaticDiagramRenderable(
        ctx,
        renderGridStyledText(
          grid,
          resolveFlowchartStyleColors({
            node: color(colors.primary),
            database: color(colors.primary),
            edge: color(colors.secondary),
            label: color(colors.text),
            group: color(colors.muted),
          }),
        ),
        size.height,
      )
    }
    case "sequence": {
      const grid = drawSequenceDiagramGrid(parseMermaidSequenceDiagram(source), { compact: options.compact })
      const size = grid.getTextSize()
      return new StaticDiagramRenderable(
        ctx,
        renderSequenceGridStyledText(
          grid,
          resolveSequenceStyleColors({
            participant: color(colors.primary),
            lifeline: color(colors.muted),
            group: color(colors.secondary),
            request: color(colors.primary),
            response: color(colors.primary),
            fragment: color(colors.secondary),
            fragmentLabelBg: color(colors.background),
            note: color(colors.warning),
            noteBg: color(colors.background),
          }),
        ),
        size.height,
      )
    }
    case "state": {
      const grid = drawStateDiagramGrid(parseMermaidStateDiagram(source))
      const size = grid.getTextSize({ trimBottom: true })
      return new StaticDiagramRenderable(
        ctx,
        renderStateGridStyledText(
          grid,
          resolveStateStyleColors({
            state: color(colors.primary),
            composite: color(colors.muted),
            transition: color(colors.secondary),
            label: color(colors.text),
            noteBorder: color(colors.warning),
            noteText: color(colors.warning),
            noteConnector: color(colors.muted),
            start: color(colors.muted),
            end: color(colors.muted),
            choice: color(colors.secondary),
          }),
        ),
        size.height,
      )
    }
  }
}

/** Create an OpenTUI Markdown node renderer for fenced Mermaid diagrams. */
export function createMermaidMarkdownRenderer(
  ctx: RenderContext,
  input: MermaidMarkdownRendererOptions | (() => MermaidMarkdownRendererOptions) = {},
): NonNullable<MarkdownOptions["renderNode"]> {
  const lastGood = new Map<string, LastGoodDiagram>()
  return createMarkdownCodeBlockRenderer({
    mermaid: (token, context) => {
      const kind = detectMermaidDiagram(token.text)
      if (!kind) return undefined
      // OpenTUI's default block ID is the stable identity available for this fence across streaming updates.
      const key = context.defaultRender()?.id
      const options = typeof input === "function" ? input() : input

      try {
        const diagram = renderDiagram(ctx, kind, token.text, options)
        if (key) claimLastGood(key, { kind, source: token.text }, diagram, lastGood)
        return diagram
      } catch (error) {
        if (error instanceof MermaidSyntaxError) {
          const previous = key ? lastGood.get(key) : undefined
          if (!previous || previous.kind !== kind) return undefined
          const diagram = renderDiagram(ctx, previous.kind, previous.source, options)
          claimLastGood(key!, previous, diagram, lastGood)
          return diagram
        }
        throw error
      }
    },
  })!
}

function claimLastGood(
  key: string,
  value: LastGoodDiagram,
  owner: StaticDiagramRenderable,
  cache: Map<string, LastGoodDiagram>,
): void {
  const claim = { ...value }
  cache.set(key, claim)
  owner.once(RenderableEvents.DESTROYED, () => {
    // Reconciliation destroys the old block before synchronously creating its replacement.
    queueMicrotask(() => {
      if (cache.get(key) === claim) cache.delete(key)
    })
  })
}
