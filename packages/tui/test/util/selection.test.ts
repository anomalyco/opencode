import { expect, test } from "bun:test"
import type { ClipboardService } from "../../src/context/clipboard"
import { Selection, copy, copyOnSelectRelease } from "../../src/util/selection"

function renderer() {
  return {
    getSelection: () => ({
      getSelectedText: () => "beta",
      selectedRenderables: [],
      isStart: false,
    }),
    clearSelection: () => {},
  }
}

function setup(text: string, isStart: boolean) {
  const writes: string[] = []
  let clears = 0
  const clipboard: ClipboardService = {
    read: async () => undefined,
    write: async (value) => {
      writes.push(value)
    },
  }
  const renderer = {
    getSelection: () => ({ getSelectedText: () => text, selectedRenderables: [], isStart }),
    clearSelection: () => {
      clears++
    },
    currentFocusedRenderable: null,
  }
  const toast = { show: () => {}, error: () => {} }
  return { clipboard, renderer, toast, writes, clears: () => clears }
}

test("copy writes selected text without clearing the highlight", () => {
  let cleared = false
  const copied = copy(
    {
      getSelection: () => ({
        getSelectedText: () => "beta",
        selectedRenderables: [],
        isStart: false,
      }),
      clearSelection: () => {
        cleared = true
      },
    },
    { show: () => {}, error: () => {} },
    {
      async read() {
        return undefined
      },
      async write() {},
    },
  )
  expect(copied).toBe(true)
  expect(cleared).toBe(false)
})

test("copy-on-select ignores a later non-drag release", () => {
  const writes: string[] = []
  const clipboard = {
    async read() {
      return undefined
    },
    async write(value: string) {
      writes.push(value)
    },
  }
  const toast = { show: () => {}, error: () => {} }
  expect(copyOnSelectRelease({}, renderer(), toast, clipboard)).toBe(false)
  expect(copyOnSelectRelease({ isDragging: false }, renderer(), toast, clipboard)).toBe(false)
  expect(copyOnSelectRelease({ isDragging: true }, renderer(), toast, clipboard)).toBe(true)
  expect(writes).toEqual(["beta"])
})

test("clears a click-only selection without copying", () => {
  const value = setup("x", true)
  expect(Selection.copy(value.renderer, value.toast, value.clipboard)).toBeFalse()
  expect(value.clears()).toBe(1)
  expect(value.writes).toEqual([])
})

test("clears an empty dragged selection without copying", () => {
  const value = setup("", false)
  expect(Selection.copy(value.renderer, value.toast, value.clipboard)).toBeFalse()
  expect(value.clears()).toBe(1)
  expect(value.writes).toEqual([])
})

test("copies a non-empty dragged selection without clearing its highlight", async () => {
  const value = setup("selected", false)
  expect(Selection.copy(value.renderer, value.toast, value.clipboard)).toBeTrue()
  await Promise.resolve()
  expect(value.clears()).toBe(0)
  expect(value.writes).toEqual(["selected"])
})
