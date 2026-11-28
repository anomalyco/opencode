import { expect, test } from "bun:test"
import type { EditorSelection } from "../src/context/editor"
import { attachedEditorSelection, editorSelectionKey, pendingEditorSelection } from "../src/prompt/editor-context"

function selection(): EditorSelection {
  return {
    filePath: "src/example.ts",
    ranges: [
      {
        text: "const a = 1",
        selection: { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } },
      },
    ],
  }
}

const base = { enabled: true, sent: false, dismissed: undefined }

test("an attached selection is sent while file context is on", () => {
  expect(pendingEditorSelection({ ...base, selection: selection() })).toEqual(selection())
})

test("nothing is sent when the selection was already sent", () => {
  expect(pendingEditorSelection({ ...base, selection: selection(), sent: true })).toBeUndefined()
})

test("nothing is sent when file context is disabled", () => {
  expect(pendingEditorSelection({ ...base, selection: selection(), enabled: false })).toBeUndefined()
})

test("nothing is sent when the selection was dismissed", () => {
  const dismissed = editorSelectionKey(selection())
  expect(pendingEditorSelection({ ...base, selection: selection(), dismissed })).toBeUndefined()
})

test("the same selection pushed again stays hidden, a different one is sent", () => {
  const dismissed = editorSelectionKey(selection())
  const other = { ...selection(), filePath: "src/other.ts" }

  expect(pendingEditorSelection({ ...base, selection: selection(), dismissed })).toBeUndefined()
  expect(pendingEditorSelection({ ...base, selection: other, dismissed })).toEqual(other)
})

test("the composer still shows an attached selection after it was sent", () => {
  const attached = attachedEditorSelection({ selection: selection(), enabled: true, dismissed: undefined })

  expect(attached).toEqual(selection())
  expect(attachedEditorSelection({ selection: selection(), enabled: false, dismissed: undefined })).toBeUndefined()
})
