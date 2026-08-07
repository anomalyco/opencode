import { renderStateDiagram, renderStateDiagramAnsi } from "./diagram.js"
import type { StateDiagramAnsiOptions, StateDiagramRenderOptions } from "./types.js"

export type {
  StateDiagram as Diagram,
  StateDiagramAnsiOptions as AnsiRenderOptions,
  StateDiagramAnsiTheme as Theme,
  StateDiagramArrowHeadStyle as ArrowHeadStyle,
  StateDiagramCompositeState as CompositeState,
  StateDiagramDirection as Direction,
  StateDiagramNote as Note,
  StateDiagramRenderOptions as PlainRenderOptions,
  StateDiagramState as State,
  StateDiagramTransition as Transition,
} from "./types.js"
export { isMermaidStateDiagram as is, parseMermaidStateDiagram as parse } from "./parser.js"

export interface RenderOptions extends StateDiagramAnsiOptions {
  /** Emit ANSI color escapes. Default: `true`. Pass `false` for plain text. */
  color?: boolean
}

/**
 * Render a Mermaid state diagram string for the terminal.
 *
 * Defaults to ANSI-colored output. Pass `{ color: false }` for plain text.
 */
export function render(content: string, options: RenderOptions = {}): string {
  const { color = true, ...rest } = options
  return color ? renderStateDiagramAnsi(content, rest) : renderStateDiagram(content, rest as StateDiagramRenderOptions)
}
