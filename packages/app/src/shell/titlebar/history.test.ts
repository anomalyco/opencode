import { describe, expect, test } from "bun:test"
import { applyPath, type TitlebarHistory } from "./history"

describe("titlebar history", () => {
  test("starts with only the actual entry", () => {
    expect(applyPath({ stack: [], index: 0 }, "/settings")).toEqual({ stack: ["/settings"], index: 0 })
  })

  test("append and trim keeps max bounded", () => {
    const state = ["/", "/a", "/b", "/c"].reduce<TitlebarHistory>((state, path) => applyPath(state, path, {}, 3), {
      stack: [],
      index: 0,
    })
    expect(state).toEqual({ stack: ["/a", "/b", "/c"], index: 2 })
    expect(applyPath(state, "/b", -1).index).toBe(1)
  })

  test("replacing settings tabs keeps the forward entries", () => {
    const state = { stack: ["/session", "/settings?tab=general", "/other"], index: 1 }
    const next = applyPath(state, "/settings?tab=models", { replace: true })
    expect(next).toEqual({ stack: ["/session", "/settings?tab=models", "/other"], index: 1 })
    expect(applyPath(next, "/session", -1).index).toBe(0)
    expect(applyPath(next, "/other", 1).index).toBe(2)
  })

  test("native traversal does not append entries", () => {
    const state = { stack: ["/session", "/settings?tab=models"], index: 1 }
    const back = applyPath(state, "/session", -1)
    expect(back).toEqual({ ...state, index: 0 })
    expect(applyPath(back, "/settings?tab=models", 1)).toEqual(state)
  })

  test("memory history traversal without a leave event preserves the stack", () => {
    const state = { stack: ["/session", "/settings?tab=models"], index: 1 }
    const back = applyPath(state, "/session")
    expect(back).toEqual({ ...state, index: 0 })
    expect(applyPath(back, "/settings?tab=models")).toEqual(state)
  })

  test("pushing a previously visited path is not mistaken for traversal", () => {
    const state = { stack: ["/session", "/settings", "/other"], index: 1 }
    expect(applyPath(state, "/session", {})).toEqual({ stack: ["/session", "/settings", "/session"], index: 2 })
  })
})
