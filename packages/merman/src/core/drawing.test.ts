import { describe, expect, test } from "bun:test"
import { BorderChars } from "@opentui/core"
import { DiagramCanvas } from "./canvas.js"
import {
  diagramArrowHead,
  drawDiagramDiamond,
  drawDiagramFrame,
  drawOrthogonalPath,
  mergeDiagramLineGlyph,
} from "./drawing.js"

describe("diagram drawing", () => {
  test("merges line glyphs with square and rounded corners", () => {
    expect(mergeDiagramLineGlyph("─", "│")).toBe("┼")
    expect(mergeDiagramLineGlyph("─", "│", "rounded")).toBe("┼")
    expect(mergeDiagramLineGlyph("─", "╭", "rounded")).toBe("┬")
    expect(mergeDiagramLineGlyph("a", "│")).toBeUndefined()
  })

  test("draws frames through caller-provided cell writers", () => {
    const canvas = new DiagramCanvas<"frame">(8, 4)
    drawDiagramFrame(
      { left: 1, top: 0, width: 6, height: 4, centerX: 4, centerY: 2 },
      BorderChars.rounded,
      (x, y, char) => canvas.setCell(x, y, char, "frame"),
    )

    expect(canvas.toString({ trimBottom: true })).toBe(" ╭────╮\n │    │\n │    │\n ╰────╯")
  })

  test("draws diamond frames through caller-provided cell writers", () => {
    const canvas = new DiagramCanvas<"frame">(9, 5)
    drawDiagramDiamond({ left: 0, top: 0, width: 9, height: 5, centerX: 4, centerY: 2 }, (x, y, char) =>
      canvas.setCell(x, y, char, "frame"),
    )

    expect(canvas.toString({ trimBottom: true })).toBe("  ╭───╮\n╭─╯   ╰─╮\n│       │\n╰─╮   ╭─╯\n  ╰───╯")
    expect(canvas.toString()).not.toMatch(/[╱╲\\/]/)
  })

  test("draws orthogonal paths with selected corner style", () => {
    const canvas = new DiagramCanvas<"edge">(7, 4)
    drawOrthogonalPath(
      [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 2 },
        { x: 6, y: 2 },
      ],
      (x, y, char) => canvas.setCell(x, y, char, "edge"),
      { cornerStyle: "rounded" },
    )

    expect(canvas.toString({ trimBottom: true })).toBe("───╮\n   │\n   ╰──")
  })

  test("draws orthogonal paths with heavy line style", () => {
    const canvas = new DiagramCanvas<"edge">(7, 4)
    drawOrthogonalPath(
      [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 2 },
        { x: 6, y: 2 },
      ],
      (x, y, char) => canvas.setCell(x, y, char, "edge"),
      { lineStyle: "heavy" },
    )

    expect(canvas.toString({ trimBottom: true })).toBe("━━━┓\n   ┃\n   ┗━━")
  })

  test("draws orthogonal paths with dashed line style", () => {
    const canvas = new DiagramCanvas<"edge">(9, 1)
    drawOrthogonalPath(
      [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
      ],
      (x, y, char) => canvas.setCell(x, y, char, "edge"),
      { lineStyle: "dashed" },
    )

    expect(canvas.toString({ trimBottom: true })).toBe("─ ─ ─ ─")
  })

  test("keeps container frame policy separate from edge drawing policy", () => {
    const canvas = new DiagramCanvas<"group" | "edge">(8, 5, {
      mergeCell: (existing, incoming) => {
        if (incoming.style === "edge") return incoming
        return existing.char === " " ? incoming : existing
      },
    })

    drawDiagramFrame(
      { left: 1, top: 0, width: 6, height: 5, centerX: 4, centerY: 2 },
      BorderChars.rounded,
      (x, y, char) => canvas.setCell(x, y, char, "group"),
    )
    drawOrthogonalPath(
      [
        { x: 0, y: 2 },
        { x: 7, y: 2 },
      ],
      (x, y, char) => canvas.setCell(x, y, char, "edge"),
    )
    canvas.setCell(7, 2, "▶", "edge")

    expect(canvas.toString({ trimBottom: true })).toBe(" ╭────╮\n │    │\n───────▶\n │    │\n ╰────╯")
  })

  test("selects filled and line arrow heads", () => {
    expect(diagramArrowHead("right")).toBe("▶")
    expect(diagramArrowHead("left", "line")).toBe("←")
  })
})
