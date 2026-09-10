import { expect, test } from "bun:test"
import { Selection } from "../src/util/selection"

function createRenderer(
  selected?: string,
  focus?: { hasSelection: () => boolean; getClipboardText: (text: string) => string },
) {
  let current = selected
  return {
    cleared: 0,
    currentFocusedRenderable: focus ?? null,
    getSelection() {
      if (current === undefined) return null
      return {
        getSelectedText: () => current!,
        selectedRenderables: focus ? [focus] : [],
      }
    },
    clearSelection() {
      current = undefined
      this.cleared++
    },
  }
}

const toast = { show: () => {}, error: () => {} }
const clipboard = { write: async () => {} }

test("text reads the highlight without clearing it", () => {
  const renderer = createRenderer("hello\nworld")
  expect(Selection.text(renderer)).toBe("hello\nworld")
  // the command clears only once the quote is in the prompt, so a failure keeps the highlight
  expect(renderer.cleared).toBe(0)
  expect(Selection.text(createRenderer())).toBeUndefined()
})

test("copy-on-select retains the highlight so it can still be added to the prompt", () => {
  const renderer = createRenderer("from the response")
  expect(Selection.copy(renderer, toast, clipboard, { retain: true })).toBe(true)
  expect(renderer.cleared).toBe(0)
  expect(Selection.text(renderer)).toBe("from the response")
})

test("an explicit copy clears the highlight", () => {
  const renderer = createRenderer("from the response")
  expect(Selection.copy(renderer, toast, clipboard)).toBe(true)
  expect(renderer.getSelection()).toBeNull()
  expect(Selection.text(renderer)).toBeUndefined()
})

test("text expands placeholders when the selection is inside the focused input", () => {
  const focus = {
    hasSelection: () => true,
    getClipboardText: (text: string) => text.replace("[Pasted ~3 lines]", "a\nb\nc"),
  }
  expect(Selection.text(createRenderer("look at [Pasted ~3 lines]", focus))).toBe("look at a\nb\nc")
})

test("quote leaves no trailing whitespace on blank or padded lines", () => {
  expect(Selection.quote("first\n\nsecond   ")).toBe("> first\n>\n> second\n")
  expect(Selection.quote("   \nonly")).toBe(">\n> only\n")
})

test("quote nests an already quoted region rather than flattening it", () => {
  expect(Selection.quote("> cited\nreply")).toBe("> > cited\n> reply\n")
})
