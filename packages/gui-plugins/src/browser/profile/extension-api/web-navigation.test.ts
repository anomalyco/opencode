import { expect, test } from "bun:test"
import { fragmentOnly, frameIds } from "./web-navigation"

test("frames get Chrome's ids: 0 for the top frame, their tree node id below it", () => {
  const top = { frameTreeNodeId: 1, parent: null }
  const child = { frameTreeNodeId: 9, parent: top }
  const grandchild = { frameTreeNodeId: 12, parent: child }

  expect(frameIds(top, true)).toEqual({ frameId: 0, parentFrameId: -1 })
  expect(frameIds(child, false)).toEqual({ frameId: 9, parentFrameId: 0 })
  expect(frameIds(grandchild, false)).toEqual({ frameId: 12, parentFrameId: 9 })
})

test("an in-page navigation is a fragment change only when nothing but the fragment moved", () => {
  expect(fragmentOnly("https://a.com/x#one", "https://a.com/x#two")).toBe(true)
  expect(fragmentOnly("https://a.com/x", "https://a.com/y")).toBe(false)
  expect(fragmentOnly(undefined, "https://a.com/x#two")).toBe(false)
})
