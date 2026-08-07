import {
  createMarkdownCodeBlockRenderer,
  type ColorInput,
  type MarkdownOptions,
  type MouseEvent,
  type RenderContext,
} from "@opentui/core"
import { MermaidSyntaxError } from "./diagnostics.js"
import { detectMermaidDiagram } from "./detect.js"
import { FlowchartDiagramRenderable } from "./flowchart/renderable.js"
import { parseMermaidFlowchartDiagram } from "./flowchart/parser.js"
import { parseMermaidSequenceDiagram } from "./sequence/parser.js"
import { SequenceDiagramRenderable } from "./sequence/renderable.js"
import { parseMermaidStateDiagram } from "./state/parser.js"
import { StateDiagramRenderable } from "./state/renderable.js"

export interface MermaidMarkdownRendererOptions {
  compact?: boolean
  colors?: {
    text?: ColorInput
    primary?: ColorInput
    secondary?: ColorInput
    muted?: ColorInput
    accent?: ColorInput
    warning?: ColorInput
    background?: ColorInput
  }
}

/** Create an OpenTUI Markdown node renderer for fenced Mermaid diagrams. */
export function createMermaidMarkdownRenderer(
  ctx: RenderContext,
  input: MermaidMarkdownRendererOptions | (() => MermaidMarkdownRendererOptions) = {},
): NonNullable<MarkdownOptions["renderNode"]> {
  return createMarkdownCodeBlockRenderer({
    mermaid: (token) => {
      const kind = detectMermaidDiagram(token.text)
      if (!kind) return undefined

      try {
        switch (kind) {
          case "flowchart":
            parseMermaidFlowchartDiagram(token.text)
            break
          case "sequence":
            parseMermaidSequenceDiagram(token.text)
            break
          case "state":
            parseMermaidStateDiagram(token.text)
            break
        }
        const options = typeof input === "function" ? input() : input
        const colors = options.colors ?? {}
        const diagram = (() => {
          switch (kind) {
            case "flowchart":
              return new FlowchartDiagramRenderable(ctx, {
                content: token.text,
                compact: options.compact,
                nodeColor: colors.primary,
                databaseColor: colors.secondary,
                edgeColor: colors.muted,
                labelColor: colors.text,
                groupColor: colors.secondary,
              })
            case "sequence":
              return new SequenceDiagramRenderable(ctx, {
                content: token.text,
                compact: options.compact,
                participantColor: colors.primary,
                lifelineColor: colors.muted,
                groupColor: colors.secondary,
                requestColor: colors.primary,
                responseColor: colors.secondary,
                noteColor: colors.warning,
                noteBackgroundColor: colors.background,
              })
            case "state":
              return new StateDiagramRenderable(ctx, {
                content: token.text,
                stateColor: colors.primary,
                compositeColor: colors.secondary,
                transitionColor: colors.muted,
                labelColor: colors.text,
                noteBorderColor: colors.warning,
                noteTextColor: colors.warning,
                noteConnectorColor: colors.muted,
                activeStateColor: colors.accent,
                activeTransitionColor: colors.accent,
              })
          }
        })()
        diagram.width = "100%"
        diagram.height = diagram.renderedHeight
        diagram.selectable = false
        let drag: { x: number; y: number } | undefined
        diagram.onMouseDown = (event: MouseEvent) => {
          if (event.button !== 0) return
          drag = { x: event.x, y: event.y }
          event.preventDefault()
          event.stopPropagation()
        }
        diagram.onMouseDrag = (event: MouseEvent) => {
          if (!drag) return
          const dx = event.x - drag.x
          drag = { x: event.x, y: event.y }
          if (dx) diagram.scrollX -= dx
          event.preventDefault()
          event.stopPropagation()
        }
        diagram.onMouseDragEnd = () => {
          drag = undefined
        }
        diagram.onMouseUp = (event: MouseEvent) => {
          if (event.button !== 0) return
          drag = undefined
          event.preventDefault()
          event.stopPropagation()
        }
        return diagram
      } catch (error) {
        if (error instanceof MermaidSyntaxError) return undefined
        throw error
      }
    },
  })!
}
