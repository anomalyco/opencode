import { describe, expect, test } from "bun:test"
import { flowchartEdgeLabelLayout } from "./labels.js"

const measure = (text: string): number => text.length

describe("flowchart edge labels", () => {
  test("places vertical-route labels beside the bus", () => {
    expect(
      flowchartEdgeLabelLayout(
        [
          { x: 22, y: 3 },
          { x: 22, y: 7 },
        ],
        "rollback",
        measure,
      ).point,
    ).toEqual({ x: 23, y: 5 })
  })

  test("places labels inline only when padded text fits with clearance", () => {
    expect(
      flowchartEdgeLabelLayout(
        [
          { x: 0, y: 2 },
          { x: 13, y: 2 },
        ],
        "rollback",
        measure,
      ).point,
    ).toEqual({ x: 2, y: 2 })

    expect(
      flowchartEdgeLabelLayout(
        [
          { x: 0, y: 2 },
          { x: 9, y: 2 },
        ],
        "rollback",
        measure,
      ).point,
    ).toEqual({ x: 2, y: 1 })

    expect(
      flowchartEdgeLabelLayout(
        [
          { x: 0, y: 2 },
          { x: 7, y: 2 },
        ],
        "rollback",
        measure,
      ).point,
    ).toEqual({ x: 2, y: 1 })
  })

  test("uses vertical bus labels before short terminal branches", () => {
    expect(
      flowchartEdgeLabelLayout(
        [
          { x: 155, y: 5 },
          { x: 150, y: 5 },
          { x: 150, y: 9 },
          { x: 146, y: 9 },
        ],
        "rollback",
        measure,
      ).point,
    ).toEqual({ x: 151, y: 7 })
  })

  test("measures br-delimited edge label lines as a block", () => {
    const layout = flowchartEdgeLabelLayout(
      [
        { x: 0, y: 2 },
        { x: 20, y: 2 },
      ],
      "first<br/>second line",
      measure,
    )

    expect(layout.lines).toEqual([" first ", " second line "])
    expect(layout.width).toBe(13)
    expect(layout.height).toBe(2)
  })

  test("places multiline horizontal edge labels outside the route row", () => {
    const layout = flowchartEdgeLabelLayout(
      [
        { x: 0, y: 5 },
        { x: 20, y: 5 },
      ],
      "first<br/>second",
      measure,
    )

    expect(layout.point.y + layout.height).toBeLessThanOrEqual(5)
  })

  test("centers multiline vertical edge labels beside their route", () => {
    const layout = flowchartEdgeLabelLayout(
      [
        { x: 22, y: 2 },
        { x: 22, y: 10 },
      ],
      "one<br/>two<br/>three",
      measure,
    )

    expect(layout.point).toEqual({ x: 23, y: 5 })
    expect(layout.height).toBe(3)
  })
})
