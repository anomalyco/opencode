// Regression tests for swallowing the trailing atomic mention pill on
// backspace: a contenteditable="false" pill as the last node of the editor has
// no renderable collapsed caret position to its right, so deleting the
// trailing whitespace after the pill makes the caret disappear. Covers the
// swallow (including the position right after the pill), and the non-swallow
// cases: real content after the pill, caret before the pill, no pills.
import { describe, expect, test } from "bun:test"
import { swallowBackspacePill } from "@opencode-ai/session-ui/v2/prompt-input/backspace"

function createEditor() {
  const editor = document.createElement("div")
  editor.contentEditable = "true"
  document.body.appendChild(editor)
  return editor
}

function createPill(text: string) {
  const pill = document.createElement("span")
  pill.textContent = text
  pill.contentEditable = "false"
  pill.dataset.mention = "file"
  return pill
}

function setCaret(node: Node, offset: number) {
  const range = document.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

describe("swallowBackspacePill", () => {
  test("caret after trailing space swallows pill and whitespace", () => {
    const editor = createEditor()
    editor.append(document.createTextNode("check "), createPill("file.ts"), document.createTextNode(" "))
    setCaret(editor.childNodes[2]!, 1)
    expect(swallowBackspacePill(editor, "[data-mention]")).toBe(true)
    expect(editor.textContent).toBe("check ")
    expect(window.getSelection()!.isCollapsed).toBe(true)
  })

  test("caret right after trailing pill (invisible-caret state) swallows pill", () => {
    const editor = createEditor()
    editor.append(document.createTextNode("check "), createPill("file.ts"))
    setCaret(editor, 2)
    expect(swallowBackspacePill(editor, "[data-mention]")).toBe(true)
    expect(editor.textContent).toBe("check ")
  })

  test("real content after pill is left to default backspace", () => {
    const editor = createEditor()
    editor.append(createPill("file.ts"), document.createTextNode("body"))
    setCaret(editor.childNodes[1]!, 2)
    expect(swallowBackspacePill(editor, "[data-mention]")).toBe(false)
    expect(editor.childNodes.length).toBe(2)
  })

  test("caret before pill does not swallow", () => {
    const editor = createEditor()
    const text = document.createTextNode("hello ")
    editor.append(text, createPill("file.ts"), document.createTextNode(" "))
    setCaret(text, 2)
    expect(swallowBackspacePill(editor, "[data-mention]")).toBe(false)
    expect(editor.childNodes.length).toBe(3)
  })

  test("editor without pills does not swallow", () => {
    const editor = createEditor()
    const text = document.createTextNode("plain text ")
    editor.append(text)
    setCaret(text, 3)
    expect(swallowBackspacePill(editor, "[data-mention]")).toBe(false)
  })

  // ZWSP is not content: a ZWSP-only tail after a line break still swallows —
  // trim alone would treat the ZWSP as content and miss the swallow.
  test("ZWSP tail after br does not block swallow", () => {
    const editor = createEditor()
    editor.append(
      document.createTextNode("check "),
      createPill("file.ts"),
      document.createElement("br"),
      document.createTextNode("\u200B"),
    )
    setCaret(editor.childNodes[3]!, 0)
    expect(swallowBackspacePill(editor, "[data-mention]")).toBe(true)
    expect(editor.textContent.replace(/\u200B/g, "")).toBe("check ")
  })

  test("ZWSP directly after pill swallows together", () => {
    const editor = createEditor()
    editor.append(createPill("file.ts"), document.createTextNode("\u200B"))
    setCaret(editor.childNodes[1]!, 1)
    expect(swallowBackspacePill(editor, "[data-mention]")).toBe(true)
    expect(editor.textContent.replace(/\u200B/g, "")).toBe("")
  })
})
