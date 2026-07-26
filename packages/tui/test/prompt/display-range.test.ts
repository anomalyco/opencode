import { describe, expect, test } from "bun:test"
import {
  displayOffsetIndex,
  displaySlice,
  planRangeReplace,
  promptOffsetWidth,
  snapOffsetToGraphemeBoundary,
  type RangeReplaceAction,
} from "../../src/prompt/display"

function apply(initialText: string, actions: readonly RangeReplaceAction[]) {
  const calls: string[] = []
  let cursor = 0
  let text = initialText
  let selStart = 0
  let selEnd = 0
  for (const action of actions) {
    if (action.type === "setCursor") {
      cursor = action.offset
      selStart = displayOffsetIndex(text, action.offset)
      selEnd = selStart
      calls.push(`setCursor(${action.offset})`)
      continue
    }
    if (action.type === "setSelection") {
      selStart = displayOffsetIndex(text, action.start)
      selEnd = displayOffsetIndex(text, action.end)
      cursor = action.end
      calls.push(`setSelection(${action.start},${action.end})`)
      continue
    }
    if (action.type === "insertText") {
      text = text.slice(0, selStart) + action.value + text.slice(selEnd)
      cursor = selStart + promptOffsetWidth(action.value)
      selStart = cursor
      selEnd = cursor
      calls.push(`insertText(${JSON.stringify(action.value)})`)
      continue
    }
    if (action.type === "clearSelection") {
      selStart = cursor
      selEnd = cursor
      calls.push("clearSelection()")
      continue
    }
  }
  return { calls, text, cursor }
}

describe("snapOffsetToGraphemeBoundary", () => {
  test("clamp 0 to 0", () => {
    expect(snapOffsetToGraphemeBoundary("abc", 0, "down")).toBe(0)
    expect(snapOffsetToGraphemeBoundary("abc", 0, "up")).toBe(0)
  })

  test("clamp past end to total width", () => {
    expect(snapOffsetToGraphemeBoundary("abc", 99, "down")).toBe(3)
    expect(snapOffsetToGraphemeBoundary("abc", 99, "up")).toBe(3)
  })

  test("ascii boundary alignment is identity", () => {
    expect(snapOffsetToGraphemeBoundary("abcdef", 3, "down")).toBe(3)
    expect(snapOffsetToGraphemeBoundary("abcdef", 3, "up")).toBe(3)
  })

  test("CJK 你a: snap down mid-grapheme", () => {
    expect(snapOffsetToGraphemeBoundary("你a", 1, "down")).toBe(0)
    expect(snapOffsetToGraphemeBoundary("你a", 2, "down")).toBe(2)
  })

  test("CJK 你a: snap up mid-grapheme", () => {
    expect(snapOffsetToGraphemeBoundary("你a", 1, "up")).toBe(2)
    expect(snapOffsetToGraphemeBoundary("你a", 2, "up")).toBe(2)
  })

  test("emoji 😀a: snap down mid-surrogate", () => {
    expect(snapOffsetToGraphemeBoundary("😀a", 1, "down")).toBe(0)
  })

  test("ZWJ family 👨‍👩‍👧 is one grapheme (width 2)", () => {
    const family = "👨‍👩‍👧"
    expect(promptOffsetWidth(family)).toBe(2)
    expect(snapOffsetToGraphemeBoundary(family + "x", 1, "down")).toBe(0)
    expect(snapOffsetToGraphemeBoundary(family + "x", 1, "up")).toBe(2)
    expect(snapOffsetToGraphemeBoundary(family + "x", 2, "down")).toBe(2)
    expect(snapOffsetToGraphemeBoundary(family + "x", 2, "up")).toBe(2)
  })
})

describe("planRangeReplace — extmark-safe primitive", () => {
  test("replacement never calls replaceText (only setSelection+insertText+clearSelection)", () => {
    const plan = planRangeReplace("hello world", 0, 5, "J")
    const result = apply("hello world", plan.actions)
    expect(result.calls).toEqual(["setSelection(0,5)", 'insertText("J")', "clearSelection()"])
    expect(result.text).toBe("J world")
  })

  test("pure insertion uses setCursor (NOT setSelection) — empty range is not a delete", () => {
    const plan = planRangeReplace("abc", 1, 1, "X")
    const result = apply("abc", plan.actions)
    expect(result.calls).toEqual(["setCursor(1)", 'insertText("X")'])
    expect(result.text).toBe("aXbc")
  })

  test("empty-range mid-grapheme insertion: snaps DOWN only (no spurious delete)", () => {
    const plan = planRangeReplace("你a", 1, 1, "X")
    const result = apply("你a", plan.actions)
    expect(plan.actions.map((a) => a.type)).toEqual(["setCursor", "insertText"])
    expect(result.calls).toEqual(["setCursor(0)", 'insertText("X")'])
    expect(result.text).toBe("X你a")
  })

  test("CJK mid-grapheme replace [1,2) on '你a': snaps [0,2) — 你 fully selected", () => {
    const plan = planRangeReplace("你a", 1, 2, "Z")
    const result = apply("你a", plan.actions)
    expect(result.calls).toEqual(["setSelection(0,2)", 'insertText("Z")', "clearSelection()"])
    expect(result.text).toBe("Za")
  })

  test("CJK 你a, replace [0,2) with 'X': 你 dropped, a remains", () => {
    const plan = planRangeReplace("你a", 0, 2, "X")
    const result = apply("你a", plan.actions)
    expect(result.text).toBe("Xa")
  })

  test("emoji 😀x, replace [0,2) with X: 😀 dropped, x remains", () => {
    const plan = planRangeReplace("😀x", 0, 2, "X")
    const result = apply("😀x", plan.actions)
    expect(result.text).toBe("Xx")
  })

  test("emoji ZWJ 👨‍👩‍👧, replace [0,2) with X: family dropped, x remains", () => {
    const plan = planRangeReplace("👨‍👩‍👧x", 0, 2, "X")
    const result = apply("👨‍👩‍👧x", plan.actions)
    expect(result.text).toBe("Xx")
  })

  test("boundary insertion at end: cursor snaps to total width", () => {
    const plan = planRangeReplace("abc", 3, 3, "X")
    expect(plan.cursor).toBe(4)
    const result = apply("abc", plan.actions)
    expect(result.text).toBe("abcX")
  })

  test("boundary insertion at start: cursor is replacement width", () => {
    const plan = planRangeReplace("abc", 0, 0, "X")
    const result = apply("abc", plan.actions)
    expect(result.text).toBe("Xabc")
    expect(plan.cursor).toBe(1)
  })

  test("out-of-range start clamps to 0", () => {
    const plan = planRangeReplace("abc", -5, 2, "X")
    const result = apply("abc", plan.actions)
    expect(result.text).toBe("Xc")
  })

  test("out-of-range end clamps to total width", () => {
    const plan = planRangeReplace("abc", 0, 99, "X")
    const result = apply("abc", plan.actions)
    expect(result.text).toBe("X")
  })

  test("inverted range (start > end) is normalized to insertion at the smaller offset", () => {
    const plan = planRangeReplace("abc", 3, 0, "X")
    const result = apply("abc", plan.actions)
    expect(result.calls).toEqual(["setCursor(0)", 'insertText("X")'])
    expect(result.text).toBe("Xabc")
  })

  test("replacement containing newlines: cursor counts \\n as 1", () => {
    const plan = planRangeReplace("abc", 1, 1, "X\nY")
    expect(plan.cursor).toBe(4)
  })

  test("replacement containing CJK: cursor counts width 2", () => {
    const plan = planRangeReplace("abc", 0, 0, "你")
    expect(plan.cursor).toBe(2)
  })

  test("replacement containing ZWJ family: cursor counts width 2", () => {
    const plan = planRangeReplace("abc", 0, 0, "👨‍👩‍👧")
    expect(plan.cursor).toBe(2)
  })

  test("plan does not contain any replaceText action (preserves extmark controller)", () => {
    const plan = planRangeReplace("the qick brown fox", 4, 8, "quick")
    expect(plan.actions.some((a) => (a as { type: string }).type === "replaceText")).toBe(false)
  })

  test("CJK 你a: empty range at offset 2 (after 你) is a true insertion, not a delete", () => {
    const plan = planRangeReplace("你a", 2, 2, "X")
    const result = apply("你a", plan.actions)
    expect(result.calls).toEqual(["setCursor(2)", 'insertText("X")'])
    expect(result.text).toBe("你Xa")
  })

  test("emoji 😀: empty range at offset 2 (after emoji) is a true insertion", () => {
    const plan = planRangeReplace("😀a", 2, 2, "X")
    const result = apply("😀a", plan.actions)
    expect(result.calls).toEqual(["setCursor(2)", 'insertText("X")'])
    expect(result.text).toBe("😀Xa")
  })

  test("replace across newlines (\\n = 1) offsets", () => {
    const plan = planRangeReplace("ab\ncd", 3, 5, "X")
    const result = apply("ab\ncd", plan.actions)
    expect(result.text).toBe("ab\nX")
    expect(plan.cursor).toBe(4)
  })

  test("displaySlice: extract prompt-part extmark text by offset range", () => {
    const family = "👨‍👩‍👧"
    const text = family + "ab"
    expect(displaySlice(text, 0, 2)).toBe(family)
    expect(displaySlice(text, 2, 3)).toBe("a")
  })

  test("replace range wholly inside a grapheme (CJK 你) snaps to full grapheme selection", () => {
    const plan = planRangeReplace("你ab", 1, 1, "X")
    const result = apply("你ab", plan.actions)
    expect(result.calls).toEqual(["setCursor(0)", 'insertText("X")'])
    expect(result.text).toBe("X你ab")
  })
})

import { viewportScreenCoords } from "../../src/prompt/display"

describe("viewportScreenCoords", () => {
  const vp = { offsetX: 0, offsetY: 0, width: 80, height: 10 }
  test("no scroll: adds screen origin to logical position", () => {
    expect(viewportScreenCoords({ row: 2, col: 5 }, vp, 3, 1)).toEqual({ x: 8, y: 3 })
  })
  test("horizontal scroll: subtracts viewport.offsetX from col", () => {
    expect(viewportScreenCoords({ row: 0, col: 40 }, { ...vp, offsetX: 30 }, 3, 1)).toEqual({ x: 13, y: 1 })
  })
  test("vertical scroll: subtracts viewport.offsetY from row", () => {
    expect(viewportScreenCoords({ row: 12, col: 0 }, { ...vp, offsetY: 5 }, 0, 0)).toEqual({ x: 0, y: 7 })
  })
  test("col scrolled left of viewport → null", () => {
    expect(viewportScreenCoords({ row: 0, col: 10 }, { ...vp, offsetX: 30 }, 0, 0)).toBeNull()
  })
  test("col past right edge → null", () => {
    expect(viewportScreenCoords({ row: 0, col: 85 }, vp, 0, 0)).toBeNull()
  })
  test("row above viewport → null", () => {
    expect(viewportScreenCoords({ row: 1, col: 0 }, { ...vp, offsetY: 5 }, 0, 0)).toBeNull()
  })
  test("row below viewport → null", () => {
    expect(viewportScreenCoords({ row: 10, col: 0 }, vp, 0, 0)).toBeNull()
  })
})
