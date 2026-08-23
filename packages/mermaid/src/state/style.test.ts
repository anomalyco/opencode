import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { drawStateDiagramGrid } from "./drawing.js"
import { parseMermaidStateDiagram } from "./parser.js"
import { resolveStateStyleColors } from "./style.js"

describe("state note connector styles", () => {
  test("ramps the final connector cells into the note border", () => {
    const grid = drawStateDiagramGrid(
      parseMermaidStateDiagram(`stateDiagram-v2
  direction LR
  A --> B
  note right of A : note`),
    )
    const connectorStyles = grid.rows.flatMap((row) =>
      row.map((cell) => cell.style).filter((style) => style?.startsWith("noteConnectorRamp")),
    )

    expect(new Set(connectorStyles)).toEqual(
      new Set(["noteConnectorRamp1", "noteConnectorRamp2", "noteConnectorRamp3"]),
    )
  })

  test("resolves the ramp from connector color toward border color", () => {
    const colors = resolveStateStyleColors({
      noteConnector: RGBA.fromInts(0, 0, 0, 255),
      noteBorder: RGBA.fromInts(200, 200, 200, 255),
    })
    const reds = [
      colors.noteConnector.toInts()[0],
      colors.noteConnectorRamp1.toInts()[0],
      colors.noteConnectorRamp2.toInts()[0],
      colors.noteConnectorRamp3.toInts()[0],
      colors.noteBorder.toInts()[0],
    ]

    expect(reds).toEqual([...reds].sort((left, right) => left - right))
    expect(new Set(reds).size).toBe(5)
  })
})

describe("state transition departure styles", () => {
  test("ramps once from an ordinary state without restarting at a choice fork", () => {
    const grid = drawStateDiagramGrid(
      parseMermaidStateDiagram(`stateDiagram-v2
  Check --> Decision
  state Decision <<choice>>
  Decision --> Ready: yes
  Decision --> Failed: no`),
    )
    const rampStyles = grid.rows
      .flatMap((row) => row.map((cell) => cell.style))
      .filter((style) => style?.startsWith("stateDepartureRamp"))

    expect(rampStyles).toHaveLength(3)
    expect(new Set(rampStyles)).toEqual(new Set(["stateDepartureRamp1", "stateDepartureRamp2", "stateDepartureRamp3"]))
  })
})
