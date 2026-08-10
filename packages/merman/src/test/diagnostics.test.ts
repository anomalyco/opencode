import { describe, expect, test } from "bun:test"
import { MermaidSyntaxError } from "../diagnostics.js"
import { parseMermaidFlowchartDiagram } from "../flowchart/parser.js"
import { parseMermaidSequenceDiagram } from "../sequence/parser.js"
import { parseMermaidStateDiagram } from "../state/parser.js"
import { renderSequenceDiagram } from "../sequence/diagram.js"

describe("parser diagnostics", () => {
  test("ignores flowchart presentation directives that do not change terminal structure", () => {
    const diagram = parseMermaidFlowchartDiagram(`flowchart LR
  A[Start] --> B[Done]
  classDef highlight fill:#fff
  class A highlight
  style B fill:#000
  linkStyle 0 stroke:#fff`)

    expect(diagram.nodes.map((node) => node.id)).toEqual(["A", "B"])
    expect(diagram.edges).toHaveLength(1)
  })

  test("reports unsupported structural flowchart statements with source location", () => {
    expect(() =>
      parseMermaidFlowchartDiagram(`flowchart LR
  A[Start] --> B[Done]
  A --o B`),
    ).toThrow('Unsupported syntax in flowchart diagram at line 3: "A --o B"')
  })

  test("exposes structured syntax errors through top-level rendering", () => {
    try {
      renderSequenceDiagram(`sequenceDiagram
  A->>B: request
  opt retry`)
      throw new Error("expected render to reject unsupported syntax")
    } catch (error) {
      expect(error).toBeInstanceOf(MermaidSyntaxError)
      if (!(error instanceof MermaidSyntaxError)) return
      expect(error.kind).toBe("sequence")
      expect(error.lineNumber).toBe(3)
      expect(error.sourceLine).toBe("opt retry")
    }
  })

  test("reports unclosed state constructs at their opening line", () => {
    expect(() =>
      parseMermaidStateDiagram(`stateDiagram-v2
  state Running {
    [*] --> Ready`),
    ).toThrow('Unclosed composite state; expected "}" in state diagram at line 2: "state Running {"')
  })

  test("reports unsupported state statements", () => {
    expect(() => parseMermaidStateDiagram(`stateDiagram-v2\n  hide empty description`)).toThrow(
      'Unsupported syntax in state diagram at line 2: "hide empty description"',
    )
  })

  test("reports malformed sequence block endings", () => {
    expect(() =>
      parseMermaidSequenceDiagram(`sequenceDiagram
  end`),
    ).toThrow('Unexpected "end" without an open block in sequence diagram at line 2: "end"')
  })

  test("does not attach else through an unclosed nested sequence block", () => {
    expect(() =>
      parseMermaidSequenceDiagram(`sequenceDiagram
  alt available
    loop retry
  else fallback`),
    ).toThrow('Unexpected "else" without an open "alt" block in sequence diagram at line 4: "else fallback"')
  })
})
