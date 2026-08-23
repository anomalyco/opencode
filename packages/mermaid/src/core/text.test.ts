import { describe, expect, test } from "bun:test"
import { diagramTextWidth, measureDiagramTextBox, parseDiagramTextLines, splitDiagramLines } from "./text.js"

describe("diagram text helpers", () => {
  test("splits Mermaid-style line breaks", () => {
    expect(splitDiagramLines("one<br/> two <br>three")).toEqual(["one", "two", "three"])
  })

  test("extracts Mermaid italic markup from visible text", () => {
    expect(parseDiagramTextLines("plain <i>italic</i><br/><em>again</em>")).toEqual([
      {
        text: "plain italic",
        runs: [
          { text: "plain ", italic: false },
          { text: "italic", italic: true },
        ],
      },
      { text: "again", runs: [{ text: "again", italic: true }] },
    ])
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
