import { describe, expect, test } from "bun:test"
import { applyPath, backPath, forwardPath, type TitlebarHistory } from "./history"

function history(): TitlebarHistory {
  return { stack: [], index: 0, action: undefined }
}

describe("titlebar history", () => {
  test("append and trim keeps max bounded", () => {
    let state = history()
    state = applyPath(state, { url: "/" }, 3)
    state = applyPath(state, { url: "/a" }, 3)
    state = applyPath(state, { url: "/b" }, 3)
    state = applyPath(state, { url: "/c" }, 3)

    expect(state.stack.map((entry) => entry.url)).toEqual(["/a", "/b", "/c"])
    expect(state.stack.length).toBe(3)
    expect(state.index).toBe(2)
  })

  test("back and forward indexes stay correct after trimming", () => {
    let state = history()
    state = applyPath(state, { url: "/" }, 3)
    state = applyPath(state, { url: "/a" }, 3)
    state = applyPath(state, { url: "/b" }, 3)
    state = applyPath(state, { url: "/c" }, 3)

    expect(state.stack.map((entry) => entry.url)).toEqual(["/a", "/b", "/c"])
    expect(state.index).toBe(2)

    const back = backPath(state)
    expect(back?.to.url).toBe("/b")
    expect(back?.state.index).toBe(1)

    const afterBack = applyPath(back!.state, back!.to, 3)
    expect(afterBack.stack.map((entry) => entry.url)).toEqual(["/a", "/b", "/c"])
    expect(afterBack.index).toBe(1)

    const forward = forwardPath(afterBack)
    expect(forward?.to.url).toBe("/c")
    expect(forward?.state.index).toBe(2)

    const afterForward = applyPath(forward!.state, forward!.to, 3)
    expect(afterForward.stack.map((entry) => entry.url)).toEqual(["/a", "/b", "/c"])
    expect(afterForward.index).toBe(2)
  })

  test("action-driven navigation does not push duplicate history entries", () => {
    const state: TitlebarHistory = {
      stack: [{ url: "/" }, { url: "/a" }, { url: "/b" }],
      index: 2,
      action: undefined,
    }

    const back = backPath(state)
    expect(back?.to.url).toBe("/a")

    const next = applyPath(back!.state, back!.to, 10)
    expect(next.stack.map((entry) => entry.url)).toEqual(["/", "/a", "/b"])
    expect(next.index).toBe(1)
    expect(next.action).toBeUndefined()
  })

  test("settings visits retain their own route state", () => {
    const first = { url: "/settings", state: { settings: { type: "draft", draftID: "a" } } }
    const second = { url: "/settings", state: { settings: { type: "draft", draftID: "b" } } }
    const state = applyPath(applyPath(applyPath(history(), first), { url: "/b" }), second)
    const back = backPath(state)!
    const previous = backPath(applyPath(back.state, back.to))!
    expect(previous.to).toEqual(first)
    expect(forwardPath(applyPath(back.state, back.to))?.to).toEqual(second)
  })

  test("replacing settings state does not add a back navigation", () => {
    const initial = applyPath(history(), { url: "/settings", state: { tab: "general" } })
    const updated = applyPath(initial, { url: "/settings", state: { tab: "models" } })
    expect(updated.stack).toHaveLength(2)
    const back = backPath(updated)!
    expect(back.to.url).toBe("/")
    expect(forwardPath(applyPath(back.state, back.to))?.to.state).toEqual({ tab: "models" })
  })
})
