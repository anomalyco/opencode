import { describe, expect, test } from "bun:test"
import { SessionDiagram } from "../../src/session/diagram"

describe("SessionDiagram", () => {
  test("extracts mermaid block from simple text", () => {
    const blocks = SessionDiagram.extractMermaidBlocks("```mermaid\ngraph TD\n  A-->B\n```")
    expect(blocks.length).toBe(1)
    expect(blocks[0].source).toBe("graph TD\n  A-->B")
  })

  test("extracts mermaid block with leading newline", () => {
    const blocks = SessionDiagram.extractMermaidBlocks("```mermaid\ngraph TD\n  A-->B\n```")
    expect(blocks.length).toBe(1)
    expect(blocks[0].source).toContain("A-->B")
  })

  test("returns empty array when no mermaid block", () => {
    const blocks = SessionDiagram.extractMermaidBlocks("Just some text with no diagrams")
    expect(blocks.length).toBe(0)
  })

  test("extracts multiple mermaid blocks", () => {
    const text = "First:\n```mermaid\ngraph TD\n  A-->B\n```\nSecond:\n```mermaid\nsequenceDiagram\n  A->>B: Hello\n```"
    const blocks = SessionDiagram.extractMermaidBlocks(text)
    expect(blocks.length).toBe(2)
    expect(blocks[0].source).toContain("graph TD")
    expect(blocks[1].source).toContain("sequenceDiagram")
  })

  test("textWithoutMermaid removes blocks and keeps surrounding text", () => {
    const result = SessionDiagram.textWithoutMermaid("Before\n```mermaid\ngraph TD\n  A-->B\n```\nAfter")
    expect(result).not.toContain("A-->B")
    expect(result).toContain("Before")
    expect(result).toContain("After")
  })

  test("textWithoutMermaid returns placeholder when only mermaid", () => {
    const result = SessionDiagram.textWithoutMermaid("```mermaid\ngraph TD\n  A-->B\n```")
    expect(result).toBe("[Mermaid diagram generated]")
  })
})
