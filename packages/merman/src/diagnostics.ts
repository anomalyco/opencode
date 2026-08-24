export type MermaidDiagramKind = "flowchart" | "sequence" | "state" | "timeline" | "gitGraph" | "gantt"

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
