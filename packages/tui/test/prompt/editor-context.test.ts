import { describe, expect, test } from "bun:test"
import { formatEditorContext } from "../../src/prompt/editor-context"
import type { EditorSelection } from "../../src/context/editor"

function selection(input: {
  filePath?: string
  source?: "websocket" | "zed"
  ranges: Array<{ start: [number, number]; end: [number, number]; text?: string }>
}): EditorSelection {
  return {
    filePath: input.filePath ?? "/w/a.ts",
    source: input.source,
    ranges: input.ranges.map((range) => ({
      text: range.text ?? "selected text",
      selection: {
        start: { line: range.start[0], character: range.start[1] },
        end: { line: range.end[0], character: range.end[1] },
      },
    })),
  }
}

describe("formatEditorContext line numbers", () => {
  test("websocket selections render 1-based lines", () => {
    const reminder = formatEditorContext(
      selection({ source: "websocket", ranges: [{ start: [12, 0], end: [15, 3] }] }),
    )
    expect(reminder).toContain('#13-16 from "/w/a.ts"')
  })

  test("zed selections already report 1-based lines and stay verbatim", () => {
    const reminder = formatEditorContext(selection({ source: "zed", ranges: [{ start: [13, 1], end: [16, 4] }] }))
    expect(reminder).toContain('#13-16 from "/w/a.ts"')
  })

  test("a single-line websocket selection renders one number", () => {
    const reminder = formatEditorContext(
      selection({ source: "websocket", ranges: [{ start: [12, 0], end: [12, 5] }] }),
    )
    expect(reminder).toContain('#13 from "/w/a.ts"')
  })

  test("zero-width selections degrade to the opened-file note", () => {
    const reminder = formatEditorContext(
      selection({ source: "websocket", ranges: [{ start: [12, 0], end: [12, 0] }] }),
    )
    expect(reminder).toContain('opened the file "/w/a.ts"')
  })

  test("multiple selections are numbered", () => {
    const reminder = formatEditorContext(
      selection({
        source: "websocket",
        ranges: [
          { start: [12, 0], end: [12, 5] },
          { start: [20, 0], end: [21, 5] },
        ],
      }),
    )
    expect(reminder).toContain("Selection 1: #13")
    expect(reminder).toContain("Selection 2: #21-22")
  })
})
