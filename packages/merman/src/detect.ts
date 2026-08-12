import type { MermaidDiagramKind } from "./diagnostics.js"
import { isMermaidFlowchartDiagram } from "./flowchart/parser.js"
import { isMermaidSequenceDiagram } from "./sequence/parser.js"
import { isMermaidStateDiagram } from "./state/parser.js"
import { isMermaidTimelineDiagram } from "./timeline/parser.js"

export function detectMermaidDiagram(content: string): MermaidDiagramKind | undefined {
  if (isMermaidFlowchartDiagram(content)) return "flowchart"
  if (isMermaidSequenceDiagram(content)) return "sequence"
  if (isMermaidStateDiagram(content)) return "state"
  if (isMermaidTimelineDiagram(content)) return "timeline"
  return undefined
}
