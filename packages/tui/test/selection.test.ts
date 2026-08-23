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

test("take returns the active selection and clears it", () => {
  const renderer = createRenderer("hello\nworld")
  expect(Selection.take(renderer)).toBe("hello\nworld")
  expect(renderer.cleared).toBe(1)
  expect(Selection.take(renderer)).toBeUndefined()
})

test("copy-on-select retains the highlight so it can still be added to the prompt", () => {
  const renderer = createRenderer("from the response")
  expect(Selection.copy(renderer, toast, clipboard, { retain: true })).toBe(true)
  expect(renderer.cleared).toBe(0)

  expect(Selection.take(renderer)).toBe("from the response")
  expect(renderer.cleared).toBe(1)
  // nothing is highlighted anymore, so no stale text can be added
  expect(Selection.take(renderer)).toBeUndefined()
})

test("an explicit copy clears the highlight", () => {
  const renderer = createRenderer("from the response")
  expect(Selection.copy(renderer, toast, clipboard)).toBe(true)
  expect(renderer.getSelection()).toBeNull()
  expect(Selection.take(renderer)).toBeUndefined()
})

test("take trims and ignores whitespace only selections", () => {
  expect(Selection.take(createRenderer("  spaced  "))).toBe("spaced")
  expect(Selection.take(createRenderer("   \n  "))).toBeUndefined()
})

test("take expands placeholders when the selection is inside the focused input", () => {
  const focus = {
    hasSelection: () => true,
    getClipboardText: (text: string) => text.replace("[Pasted ~3 lines]", "a\nb\nc"),
  }
  expect(Selection.take(createRenderer("look at [Pasted ~3 lines]", focus))).toBe("look at a\nb\nc")
})
