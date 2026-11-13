export type MermaidDiagramKind = "flowchart" | "sequence" | "state" | "timeline" | "gitGraph" | "gantt"

/** A valid diagram whose elements cannot be placed without overlapping within the layout search budget. */
export class DiagramLayoutError extends Error {
  readonly _tag = "DiagramLayoutError"

  constructor(message: string) {
    super(message)
    this.name = "DiagramLayoutError"
  }
}

/** An otherwise valid diagram contains syntax that this renderer does not support. */
export class MermaidSyntaxError extends Error {
  readonly _tag = "MermaidSyntaxError"

  constructor(
    readonly kind: MermaidDiagramKind,
    readonly lineNumber: number,
    readonly sourceLine: string,
    reason = "Unsupported syntax",
  ) {
    super(`${reason} in ${kind} diagram at line ${lineNumber}: "${sourceLine}"`)
    this.name = "MermaidSyntaxError"
  }
}
