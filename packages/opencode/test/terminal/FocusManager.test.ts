import { test, expect } from "bun:test"
import { FocusManager } from "@/terminal/app/FocusManager"
import type { Widget } from "@/terminal/widgets/Widget"

function stub(): Widget {
  let d = false
  return {
    get dirty() { return d },
    setBounds: () => {},
    invalidate: () => { d = true },
    render: () => {},
    onFocus: () => {},
    onBlur: () => {},
    onKey: () => false,
  }
}

test("focusNext cycles forward circularly", () => {
  const fm = new FocusManager()
  const a = stub(); const b = stub(); const c = stub()
  fm.add("a", a); fm.add("b", b); fm.add("c", c)

  fm.focusNext()
  expect(fm.focusId).toBe("a")
  fm.focusNext()
  expect(fm.focusId).toBe("b")
  fm.focusNext()
  expect(fm.focusId).toBe("c")
  fm.focusNext()
  expect(fm.focusId).toBe("a")
})

test("focusPrev cycles backward circularly", () => {
  const fm = new FocusManager()
  const a = stub(); const b = stub()
  fm.add("a", a); fm.add("b", b)

  fm.focusPrev()
  expect(fm.focusId).toBe("b")
  fm.focusPrev()
  expect(fm.focusId).toBe("a")
  fm.focusPrev()
  expect(fm.focusId).toBe("b")
})

test("focusPrev from empty state goes to last", () => {
  const fm = new FocusManager()
  fm.add("a", stub()); fm.add("b", stub())
  fm.focusPrev()
  expect(fm.focusId).toBe("b")
})

test("focusById focuses the matching widget", () => {
  const fm = new FocusManager()
  fm.add("x", stub()); fm.add("y", stub())
  expect(fm.focusById("y")).toBe(true)
  expect(fm.focusId).toBe("y")
})

test("focusById returns false for unknown id", () => {
  const fm = new FocusManager()
  expect(fm.focusById("nope")).toBe(false)
})

test("remove decrements index when removing focused", () => {
  const fm = new FocusManager()
  fm.add("a", stub()); fm.add("b", stub())
  fm.focusNext()
  fm.remove("a")
  expect(fm.focusId).toBe("b")
})

test("remove clears index when all removed", () => {
  const fm = new FocusManager()
  fm.add("a", stub())
  fm.focusNext()
  fm.remove("a")
  expect(fm.focused).toBeNull()
})

test("add does not duplicate same id", () => {
  const fm = new FocusManager()
  fm.add("a", stub())
  fm.add("a", stub())
  expect(fm.count).toBe(1)
})

test("focusNext no-ops on empty manager", () => {
  const fm = new FocusManager()
  fm.focusNext()
  expect(fm.focused).toBeNull()
})

test("remove unknown id is no-op", () => {
  const fm = new FocusManager()
  fm.add("a", stub())
  fm.remove("b")
  expect(fm.count).toBe(1)
})
