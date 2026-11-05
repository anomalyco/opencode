import { describe, expect, test } from "bun:test"
import {
  INITIAL_TITLEBAR_HISTORY_STATE,
  transitionTitlebarHistory,
  type HistoryLocation,
  type TitlebarHistoryEvent,
  type TitlebarHistoryState,
} from "./history-machine"

const visit = (current: HistoryLocation | string, max?: number): TitlebarHistoryEvent => ({
  type: "location.changed",
  current: typeof current === "string" ? { url: current } : current,
  max,
})

const replay = (events: TitlebarHistoryEvent[], state = INITIAL_TITLEBAR_HISTORY_STATE) =>
  events.reduce<{ state: TitlebarHistoryState; effects: unknown[] }>(
    (current, event) => {
      const next = transitionTitlebarHistory(current.state, event)

      return { state: next.state, effects: [...current.effects, ...next.effects] }
    },
    { state, effects: [] },
  )

const urls = (state: TitlebarHistoryState) => (state.status === "disposed" ? [] : state.stack.map((entry) => entry.url))

const at = (state: TitlebarHistoryState) => (state.status === "disposed" ? undefined : state.stack[state.index]?.url)

// Steps Back or Forward and returns where it navigates.
const step = (state: TitlebarHistoryState, type: "back" | "forward") => {
  const result = transitionTitlebarHistory(state, { type })
  const effect = result.effects.find((item) => item.type === "navigate")

  return { state: result.state, to: effect?.type === "navigate" ? effect.to : undefined, attempt: effect?.attempt }
}

describe("titlebar history", () => {
  test("a redirect during Back is a new visit, not swallowed", () => {
    const start = replay([visit("/"), visit("/a"), visit("/b")]).state
    const back = step(start, "back")
    expect(back.to?.url).toBe("/a")

    // `/a` redirects to `/c`, or the user clicks `/c` while `/a` is still loading.
    const arrived = transitionTitlebarHistory(back.state, visit("/c"))
    expect(arrived.state.status).toBe("idle")
    expect(urls(arrived.state)).toEqual(["/", "/a", "/b", "/c"])
    expect(at(arrived.state)).toBe("/c")
    expect(arrived.effects).toEqual([{ type: "timer.clear" }])
  })

  test("a Back the router never carries out stops waiting, and the next navigation still records", () => {
    const start = replay([visit("/"), visit("/a"), visit("/b")]).state
    const back = step(start, "back")

    // The router ignored the navigation: no location ever arrives, and the timer fires where the router still is.
    const timedOut = transitionTitlebarHistory(back.state, {
      type: "traverse.timed-out",
      attempt: back.attempt!,
      currentUrl: "/b",
    })
    expect(timedOut.state.status).toBe("idle")
    expect(at(timedOut.state)).toBe("/b")

    const next = transitionTitlebarHistory(timedOut.state, visit("/d"))
    expect(urls(next.state)).toEqual(["/", "/a", "/b", "/d"])
  })

  test("a timer that fires after the router arrived lands on the target", () => {
    const back = step(replay([visit("/"), visit("/a"), visit("/b")]).state, "back")
    const timedOut = transitionTitlebarHistory(back.state, {
      type: "traverse.timed-out",
      attempt: back.attempt!,
      currentUrl: "/a",
    })

    expect(at(timedOut.state)).toBe("/a")
  })

  test("Back twice before the router arrives steps from the pending target and ignores the first timer", () => {
    const first = step(replay([visit("/"), visit("/a"), visit("/b")]).state, "back")
    const second = step(first.state, "back")
    expect(second.to?.url).toBe("/")

    const stale = transitionTitlebarHistory(second.state, {
      type: "traverse.timed-out",
      attempt: first.attempt!,
      currentUrl: "/b",
    })
    expect(stale.state).toBe(second.state)

    const arrived = transitionTitlebarHistory(second.state, visit("/"))
    expect(urls(arrived.state)).toEqual(["/", "/a", "/b"])
    expect(at(arrived.state)).toBe("/")
    expect(step(arrived.state, "forward").to?.url).toBe("/a")
  })

  test("trims to the maximum and keeps back and forward indexes correct", () => {
    const state = replay(["/", "/a", "/b", "/c"].map((url) => visit(url, 3))).state
    expect(urls(state)).toEqual(["/a", "/b", "/c"])

    const back = step(state, "back")
    expect(back.to?.url).toBe("/b")
    const afterBack = transitionTitlebarHistory(back.state, visit("/b", 3)).state
    expect(urls(afterBack)).toEqual(["/a", "/b", "/c"])
    expect(at(afterBack)).toBe("/b")

    const forward = step(afterBack, "forward")
    expect(forward.to?.url).toBe("/c")
    expect(at(transitionTitlebarHistory(forward.state, visit("/c", 3)).state)).toBe("/c")
  })

  test("Back and Forward stop at the ends without navigating", () => {
    const state = replay([visit("/"), visit("/a")]).state

    expect(transitionTitlebarHistory(state, { type: "forward" })).toEqual({ state, effects: [] })
    const home = transitionTitlebarHistory(step(state, "back").state, visit("/")).state
    expect(transitionTitlebarHistory(home, { type: "back" })).toEqual({ state: home, effects: [] })
  })

  test("settings visits retain their own route state", () => {
    const first = { url: "/settings", state: { settings: { type: "draft", draftID: "a" } } }
    const second = { url: "/settings", state: { settings: { type: "draft", draftID: "b" } } }
    const state = replay([visit(first), visit("/b"), visit(second)]).state
    const back = step(state, "back")
    const onB = transitionTitlebarHistory(back.state, visit(back.to!)).state

    expect(step(onB, "back").to).toEqual(first)
    expect(step(onB, "forward").to).toEqual(second)
  })

  test("settings pages and settings state replace one history entry", () => {
    const updated = replay([
      visit({ url: "/settings", state: { tab: "general" } }),
      visit({ url: "/settings", state: { tab: "models" } }),
    ]).state
    expect(urls(updated)).toEqual(["/", "/settings"])
    const back = step(updated, "back")
    expect(back.to?.url).toBe("/")
    expect(step(transitionTitlebarHistory(back.state, visit("/")).state, "forward").to?.state).toEqual({ tab: "models" })

    const project = replay([
      visit("/settings"),
      visit("/settings?tab=models"),
      visit("/settings?server=local&project=%2Fwork&tab=extensions"),
    ]).state
    expect(urls(project)).toEqual(["/", "/settings?server=local&project=%2Fwork&tab=extensions"])
  })

  test("an unchanged location keeps the same state object", () => {
    const state = replay([visit("/"), visit("/a")]).state

    expect(transitionTitlebarHistory(state, visit("/a")).state).toBe(state)
  })

  test("disposing clears a pending timer and ignores later events", () => {
    const back = step(replay([visit("/"), visit("/a")]).state, "back")
    const disposed = transitionTitlebarHistory(back.state, { type: "disposed" })

    expect(disposed).toEqual({ state: { status: "disposed" }, effects: [{ type: "timer.clear" }] })
    expect(transitionTitlebarHistory(disposed.state, visit("/b")).state).toBe(disposed.state)
  })
})
