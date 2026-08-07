import { describe, expect, test } from "bun:test"
import { diagramTextWidth, measureDiagramTextBox, splitDiagramLines } from "./text.js"

describe("diagram text helpers", () => {
  test("splits Mermaid-style line breaks", () => {
    expect(splitDiagramLines("one<br/> two <br>three")).toEqual(["one", "two", "three"])
  })

  test("measures padded text boxes", () => {
    expect(measureDiagramTextBox("wide<br/>x", { paddingX: 2, paddingY: 1 })).toEqual({
      width: 8,
      height: 4,
      lines: ["wide", "x"],
    })
  })

  test("measures terminal cell width", () => {
    expect(diagramTextWidth("abc")).toBe(3)
  })
})
