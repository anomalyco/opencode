import * as Flowchart from "./flowchart/index.js"
import * as Sequence from "./sequence/index.js"
import * as State from "./state/index.js"
import { type MermaidDiagramKind } from "./diagnostics.js"
import { detectMermaidDiagram } from "./detect.js"

export { Flowchart, Sequence, State }
export { MermaidSyntaxError } from "./diagnostics.js"
export { createMermaidMarkdownRenderer, type MermaidMarkdownRendererOptions } from "./markdown.js"

export type DiagramKind = MermaidDiagramKind

export type ParsedDiagram =
  | { readonly kind: "flowchart"; readonly diagram: Flowchart.Diagram }
  | { readonly kind: "sequence"; readonly diagram: Sequence.Diagram }
  | { readonly kind: "state"; readonly diagram: State.Diagram }

export interface RenderOptions {
  /** Emit ANSI color escapes. Default: `true`. Pass `false` for plain text. */
  color?: boolean
  /** Theme override. Forwarded to the matching renderer. */
  theme?: Flowchart.Theme | Sequence.Theme | State.Theme
}

export class UnknownDiagramError extends Error {
  readonly _tag = "UnknownDiagramError"
  constructor(content: string) {
    const head = firstMeaningfulLine(content) ?? "(empty)"
    super(
      `Could not detect diagram kind. Expected the first non-empty line to start with ` +
        `"flowchart", "graph", "sequenceDiagram", or "stateDiagram[-v2]". Got: "${head}"`,
    )
    this.name = "UnknownDiagramError"
  }
}

function firstMeaningfulLine(content: string): string | undefined {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("%%"))
}

/**
 * Detect the diagram kind from the leading Mermaid declaration.
 *
 * Returns `undefined` if the content does not look like any supported diagram.
 */
export function detect(content: string): DiagramKind | undefined {
  return detectMermaidDiagram(content)
}

/** True if the content is recognizably a supported Mermaid diagram. */
export function isMermaid(content: string): boolean {
  return detect(content) !== undefined
}

/**
 * Render any supported Mermaid string for the terminal.
 *
 * The leading `flowchart`/`sequenceDiagram`/`stateDiagram-v2` line picks the
 * right renderer. Defaults to ANSI-colored output; pass `{ color: false }`
 * for plain text.
 *
 * @throws {UnknownDiagramError} if the diagram kind cannot be detected.
 */
export function render(content: string, options: RenderOptions = {}): string {
  const kind = detect(content)
  if (!kind) throw new UnknownDiagramError(content)
  const opts = options as { color?: boolean; theme?: unknown }
  switch (kind) {
    case "flowchart":
      return Flowchart.render(content, opts as Flowchart.RenderOptions)
    case "sequence":
      return Sequence.render(content, opts as Sequence.RenderOptions)
    case "state":
      return State.render(content, opts as State.RenderOptions)
  }
}

/**
 * Parse any supported Mermaid string into a discriminated union AST.
 *
 * @throws {UnknownDiagramError} if the diagram kind cannot be detected.
 */
export function parse(content: string): ParsedDiagram {
  const kind = detect(content)
  if (!kind) throw new UnknownDiagramError(content)
  switch (kind) {
    case "flowchart":
      return { kind, diagram: Flowchart.parse(content) }
    case "sequence":
      return { kind, diagram: Sequence.parse(content) }
    case "state":
      return { kind, diagram: State.parse(content) }
  }
}
