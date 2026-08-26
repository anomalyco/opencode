import { expect, test } from "bun:test"
import type { SelectionBehavior } from "@opentui/core"
import type { ClipboardService } from "../../src/context/clipboard"
import { Selection, copy, copyOnSelectRelease } from "../../src/util/selection"

function renderer() {
  return {
    getSelection: () => ({
      getSelectedText: () => "beta",
      selectedRenderables: [],
      isStart: false,
      behavior: "cell" as const,
    }),
    clearSelection: () => {},
  }
}

function setup(text: string, isStart: boolean, behavior: SelectionBehavior = "cell") {
  const writes: string[] = []
  let clears = 0
  const clipboard: ClipboardService = {
    read: async () => undefined,
    write: async (value) => {
      writes.push(value)
    },
  }
  const renderer = {
    getSelection: () => ({ getSelectedText: () => text, selectedRenderables: [], isStart, behavior }),
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
        behavior: "cell",
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

test("clears a nonempty click-only selection without copying", () => {
  const value = setup("x", true)
  expect(Selection.copy(value.renderer, value.toast, value.clipboard)).toBeFalse()
  expect(value.clears()).toBe(1)
  expect(value.writes).toEqual([])
})

test("ignores an empty click-only selection without resetting multi-click tracking", () => {
  const value = setup("", true)
  expect(Selection.copy(value.renderer, value.toast, value.clipboard)).toBeFalse()
  expect(value.clears()).toBe(0)
  expect(value.writes).toEqual([])
})

test("ignores an empty dragged selection without resetting multi-click tracking", () => {
  const value = setup("", false)
  expect(Selection.copy(value.renderer, value.toast, value.clipboard)).toBeFalse()
  expect(value.clears()).toBe(0)
  expect(value.writes).toEqual([])
})

test("copies a non-empty dragged selection without clearing its highlight", async () => {
  const value = setup("selected", false)
  expect(Selection.copy(value.renderer, value.toast, value.clipboard)).toBeTrue()
  await Promise.resolve()
  expect(value.clears()).toBe(0)
  expect(value.writes).toEqual(["selected"])
})

test.each(["word", "line"] as const)("copies a %s selection without a drag", (behavior) => {
  const value = setup("selected", true, behavior)
  expect(Selection.copy(value.renderer, value.toast, value.clipboard)).toBeTrue()
  expect(value.clears()).toBe(0)
  expect(value.writes).toEqual(["selected"])
})

test.each([
  ["click-only", "x", true],
  ["empty dragged", "", false],
] as const)("ctrl+c clears the %s selection without swallowing the key", (_name, text, isStart) => {
  const value = setup(text, isStart)
  let prevented = false
  let stopped = false
  Selection.handleSelectionKey(
    value.renderer,
    value.toast,
    {
      ctrl: true,
      name: "c",
      preventDefault: () => {
        prevented = true
      },
      stopPropagation: () => {
        stopped = true
      },
    },
    value.clipboard,
  )
  expect(value.clears()).toBeGreaterThan(0)
  expect(value.writes).toEqual([])
  expect(prevented).toBeFalse()
  expect(stopped).toBeFalse()
})
