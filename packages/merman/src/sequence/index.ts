import { renderSequenceDiagram, renderSequenceDiagramAnsi } from "./diagram.js"
import type { SequenceDiagramAnsiOptions, SequenceDiagramRenderOptions } from "./types.js"

export type {
  SequenceParticipant as Participant,
  SequenceParticipantGroup as ParticipantGroup,
  SequenceMessage as Message,
  SequenceArrowHead as ArrowHead,
  SequenceNote as Note,
  SequenceActivation as Activation,
  SequenceFragment as Fragment,
  SequenceStep as Step,
  SequenceDiagram as Diagram,
  SequenceDiagramRenderOptions as PlainRenderOptions,
  SequenceDiagramAnsiTheme as Theme,
  SequenceDiagramAnsiOptions as AnsiRenderOptions,
  SequenceDiagramOptions as RenderableOptions,
} from "./types.js"

export { isMermaidSequenceDiagram as is, parseMermaidSequenceDiagram as parse } from "./parser.js"
export { SequenceDiagramRenderable as Renderable } from "./renderable.js"

export interface RenderOptions extends SequenceDiagramAnsiOptions {
  /** Emit ANSI color escapes. Default: `true`. Pass `false` for plain text. */
  color?: boolean
}

/**
 * Render a Mermaid sequence diagram string for the terminal.
 *
 * Defaults to ANSI-colored output. Pass `{ color: false }` for plain text.
 */
export function render(content: string, options: RenderOptions = {}): string {
  const { color = true, ...rest } = options
  return color
    ? renderSequenceDiagramAnsi(content, rest)
    : renderSequenceDiagram(content, rest as SequenceDiagramRenderOptions)
}
