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
          { text: "plain ", italic: false, bold: false },
          { text: "italic", italic: true, bold: false },
        ],
      },
      { text: "again", runs: [{ text: "again", italic: true, bold: false }] },
    ])
  })

  test("extracts Mermaid bold markup and nests it with italics", () => {
    expect(parseDiagramTextLines("<b>Service A</b> and <strong><i>both</i></STRONG>")).toEqual([
      {
        text: "Service A and both",
        runs: [
          { text: "Service A", italic: false, bold: true },
          { text: " and ", italic: false, bold: false },
          { text: "both", italic: true, bold: true },
        ],
      },
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
